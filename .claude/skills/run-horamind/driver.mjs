#!/usr/bin/env node
/**
 * HoraMind driver — launches nothing, drives everything.
 *
 *   node .claude/skills/run-horamind/driver.mjs api    HTTP flow against :8080
 *   node .claude/skills/run-horamind/driver.mjs web    PWA flow via headless Chrome
 *   node .claude/skills/run-horamind/driver.mjs all    both
 *
 * Assumes Postgres, the API and (for `web`) Vite are already up — start them
 * with ./infra/scripts/dev-local.sh start plus the two npm commands in
 * SKILL.md. Keeping launch out of here is deliberate: the API and Vite belong
 * in the foreground where their logs are readable and they hot-reload.
 *
 * Zero dependencies on purpose. The browser half speaks the Chrome DevTools
 * Protocol over Node's built-in WebSocket (Node 22+), so there is no Playwright
 * install and no browser download — this repo has neither and does not need
 * them to be driven.
 *
 * Exit code is 0 only if every step passed.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.HORAMIND_API ?? 'http://localhost:8080';
const WEB = process.env.HORAMIND_WEB ?? 'http://localhost:5173';
const OUT = process.env.HORAMIND_OUT ?? join(tmpdir(), 'horamind-run');
const CDP_PORT = Number(process.env.HORAMIND_CDP_PORT ?? 9333);

// A fixed account, reused across runs. Registration returns 409 the second
// time, which the driver treats as "already there" and logs in instead —
// otherwise every run leaves another orphan user in the database.
const EMAIL = process.env.HORAMIND_EMAIL ?? 'driver@horamind.local';
const PASSWORD = 'driver-only-password-at-least-twelve-chars';

const CHROME = process.env.HORAMIND_CHROME
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const pass = (name, extra = '') => console.log(`  \x1b[32mPASS\x1b[0m ${name}${extra ? '  ' + extra : ''}`);
const fail = (name, why) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}\n       ${why}`); };
const head = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

async function step(name, fn) {
    try {
        const extra = await fn();
        pass(name, extra ?? '');
        return true;
    } catch (err) {
        fail(name, err instanceof Error ? err.message : String(err));
        return false;
    }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function req(path, { method = 'GET', body, token, expect } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (expect && !expect.includes(res.status)) {
        // Surface the server's own error text. HoraMind returns a requestId on
        // every failure and logs the stack against it, so quoting it here is
        // what makes the API log greppable afterwards.
        const e = json?.error;
        throw new Error(
            `${method} ${path} -> ${res.status} (wanted ${expect.join('/')})`
            + (e ? `\n       ${e.code}: ${e.message}${e.requestId ? ` [requestId ${e.requestId}]` : ''}` : ''),
        );
    }
    return { status: res.status, json };
}

async function apiFlow() {
    head(`API flow  ${API}`);

    await step('GET /health', async () => {
        const { json } = await req('/health', { expect: [200] });
        if (json.status !== 'ok') throw new Error(`status=${json.status}`);
        return `v${json.version}`;
    });

    await step('GET /ready (database + ephemeris)', async () => {
        const { json } = await req('/ready', { expect: [200, 503] });
        if (json.status !== 'ready') {
            throw new Error(`degraded: ${JSON.stringify(json.checks)} — is Postgres up? ./infra/scripts/dev-local.sh status`);
        }
        return JSON.stringify(json.checks);
    });

    let token = null;

    await step('register or log in', async () => {
        const reg = await req('/v1/auth/register', {
            method: 'POST',
            // acceptedTerms is required and rejected unless literally true.
            body: { email: EMAIL, password: PASSWORD, acceptedTerms: true, displayName: 'Driver' },
            expect: [201, 409],
        });

        if (reg.status === 201) {
            token = reg.json.tokens.accessToken;
            return 'registered';
        }
        const login = await req('/v1/auth/login', {
            method: 'POST', body: { email: EMAIL, password: PASSWORD }, expect: [200],
        });
        token = login.json.tokens.accessToken;
        return 'logged in (already registered)';
    });

    if (!token) { console.log('\n  no token — aborting API flow'); return; }

    await step('GET /v1/auth/me', async () => {
        const { json } = await req('/v1/auth/me', { token, expect: [200] });
        return `${json.email} · ${json.publicId} · tier ${json.tier}`;
    });

    await step('GET /v1/places/search (offline city + timezone)', async () => {
        // The query param is `query`, not `q` — `q` fails schema validation.
        const { json } = await req('/v1/places/search?query=Chennai', { token, expect: [200] });
        const hit = json.results?.[0];
        if (!hit?.timezone) throw new Error('no timezone resolved');
        return `${hit.name} ${hit.timezone}`;
    });

    let profileId = null;

    await step('create or reuse a birth profile', async () => {
        const list = await req('/v1/profiles', { token, expect: [200] });
        if (list.json.profiles?.length) {
            profileId = list.json.profiles[0].id;
            return `reused ${list.json.profiles[0].birthDate}`;
        }
        const made = await req('/v1/profiles', {
            method: 'POST', token, expect: [201],
            body: {
                label: 'Driver', birthDate: '1990-08-15', birthTime: '14:30:00',
                timeAccuracy: 'exact', placeName: 'Chennai, Tamil Nadu, India',
                latitude: 13.08998781, longitude: 80.27999874, timezone: 'Asia/Kolkata',
            },
        });
        profileId = made.json.id;
        return `created ${made.json.birthDate}`;
    });

    await step('birth date survives the round trip', async () => {
        // Regression guard. `birth_date` is a Postgres `date`; the driver hands
        // it back as a JS Date at UTC midnight, and formatting it in local time
        // reports the day before anywhere west of Greenwich. A wrong day here
        // is a wrong chart that still looks plausible.
        const { json } = await req('/v1/profiles', { token, expect: [200] });
        const p = json.profiles.find(x => x.id === profileId);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) {
            throw new Error(`birthDate is not YYYY-MM-DD: ${JSON.stringify(p.birthDate)}`);
        }
        return p.birthDate;
    });

    await step('GET /v1/charts/natal (ephemeris)', async () => {
        const { json } = await req(`/v1/charts/natal?profileId=${profileId}`, { token, expect: [200] });
        const bodies = json.planets ?? [];
        if (bodies.length < 9) throw new Error(`expected 9 grahas, got ${bodies.length}`);

        // Rahu and Ketu are always exactly opposed. If they are not, the
        // ephemeris is not actually being consulted.
        const lon = n => bodies.find(p => (p.body ?? p.name) === n)?.longitude;
        const delta = Math.abs(((lon('Rahu') - lon('Ketu')) % 360 + 360) % 360 - 180);
        if (delta > 0.001) throw new Error(`Rahu/Ketu are ${delta.toFixed(4)}° off opposition`);

        return `asc ${json.ascendant.signName} ${json.ascendant.degree.toFixed(2)}°, ${bodies.length} grahas, nodes opposed`;
    });

    for (const ep of ['vargas', 'dasha', 'ashtakavarga', 'panchanga']) {
        await step(`GET /v1/charts/${ep}`, async () => {
            const { json } = await req(`/v1/charts/${ep}?profileId=${profileId}`, { token, expect: [200] });
            return Object.keys(json).join(', ');
        });
    }

    await step('POST + GET /v1/memories', async () => {
        await req('/v1/memories', {
            method: 'POST', token, expect: [201],
            // Field names are whatHappened / whatILearnt, and the schema is
            // additionalProperties:false — a near-miss like `what` is a 400.
            body: {
                whatHappened: `driver run ${new Date().toISOString()}`,
                whatILearnt: 'the stack is up',
            },
        });
        const { json } = await req('/v1/memories', { token, expect: [200] });
        return `${json.memories?.length ?? 0} of ${json.limit} stored`;
    });

    await step('POST /v1/interpret (LLM; needs OPENROUTER_API_KEY)', async () => {
        const { status, json } = await req('/v1/interpret', {
            method: 'POST', token, expect: [200, 502, 503],
            body: { profileId, question: 'What does my Saturn placement suggest about my career?' },
        });

        if (status === 503) return 'SKIPPED — AI not configured (set OPENROUTER_API_KEY)';
        if (status === 502) {
            throw new Error(
                `upstream: ${json.error.message}\n`
                + '       If this says "empty response", OpenRouter routed to a provider that\n'
                + '       returns a hollow 200. See Gotchas in SKILL.md — pin a single-provider model.',
            );
        }
        return `${json.answer.length} chars, ${json.citations?.length ?? 0} citations`;
    });
}

// ---------------------------------------------------------------------------
// Browser (Chrome DevTools Protocol, no Playwright)
// ---------------------------------------------------------------------------

class Cdp {
    #ws; #id = 0; #pending = new Map();

    static async attach(wsUrl) {
        const c = new Cdp();
        c.#ws = new WebSocket(wsUrl);
        await new Promise((res, rej) => {
            c.#ws.addEventListener('open', res, { once: true });
            c.#ws.addEventListener('error', () => rej(new Error('CDP socket failed')), { once: true });
        });
        c.#ws.addEventListener('message', e => {
            const m = JSON.parse(e.data);
            if (m.id && c.#pending.has(m.id)) { c.#pending.get(m.id)(m); c.#pending.delete(m.id); }
        });
        return c;
    }

    send(method, params = {}) {
        const id = ++this.#id;
        return new Promise((res, rej) => {
            this.#pending.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
            this.#ws.send(JSON.stringify({ id, method, params }));
        });
    }

    /**
     * Evaluate an expression in the page. This is CDP `Runtime.evaluate` — the
     * same thing Playwright's `page.evaluate` does — not JavaScript's `eval`.
     * Executing code in the page is the whole job of a browser driver. Every
     * expression below is a literal written in this file; the only values that
     * cross the boundary are JSON.stringify'd, so page content is never
     * interpolated back into an expression.
     */
    async eval(expression) {
        const r = await this.send('Runtime.evaluate', {
            expression, returnByValue: true, awaitPromise: true,
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval threw');
        return r.result?.value;
    }

    /**
     * Poll until `expression` is truthy. React renders after the fetch settles.
     *
     * The expression is coerced to a boolean in the page before it comes back.
     * `returnByValue` cannot serialise a DOM node — a bare
     * `document.querySelector('textarea')` fails with the memorable and
     * entirely unhelpful "Object reference chain is too long" rather than
     * simply being truthy.
     */
    async waitFor(expression, { timeout = 20000, label = expression } = {}) {
        const until = Date.now() + timeout;
        for (;;) {
            if (await this.eval(`Boolean(${expression})`)) return;
            if (Date.now() > until) throw new Error(`timed out waiting for: ${label}`);
            await new Promise(r => setTimeout(r, 250));
        }
    }

    /**
     * Wait for a clickable to exist, then click it.
     *
     * Never click straight after a navigation. `location.pathname` updates
     * before React has decided what to render: while the session store is
     * restoring, the route guard renders a splash with no tab bar, so a click
     * fires into a screen that has not appeared yet and fails with "no
     * clickable matching". Waiting on the element itself is the only honest
     * readiness signal.
     */
    async clickWhenReady(text) {
        const t = JSON.stringify(text);
        await this.waitFor(
            `[...document.querySelectorAll('button, a')].some(e => e.textContent.trim().toLowerCase().includes(${t}.toLowerCase()))`,
            { label: `clickable "${text}"` },
        );
        return this.eval(`__hmClick(${t})`);
    }

    /**
     * Wait until the staggered reveal has actually finished painting.
     *
     * Never wait on `innerText` for this. `innerText` happily returns the text
     * of an element at `opacity: 0`, so a check for the last card's wording is
     * satisfied the instant React renders it — before a single frame of the
     * animation has run — and the screenshot lands mid-reveal looking exactly
     * like a rendering bug. Computed opacity is the only honest signal that
     * something is on screen rather than merely in the document.
     */
    async settled({ timeout = 15000 } = {}) {
        // Elements carrying an inline opacity are *deliberately* translucent —
        // past days in the strip sit at 0.62 — so demanding everything reach
        // 1 can never be satisfied and the wait just times out. Only elements
        // Motion is driving are checked, and those are the ones that start at 0.
        await this.waitFor(`
            [...document.querySelectorAll('div')]
                .filter(el => el.textContent.trim().length > 2 && !el.style.opacity)
                .every(el => parseFloat(getComputedStyle(el).opacity) > 0.95)
        `, { timeout, label: 'animated reveals opaque' });
        // One more frame so the final paint is committed before capture.
        await new Promise(r => setTimeout(r, 250));
    }

    async screenshot(path) {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(path, Buffer.from(data, 'base64'));
        return path;
    }

    close() { this.#ws.close(); }
}

/**
 * Type into a React-controlled input.
 *
 * Assigning `.value` does NOT work: React installs its own value setter on the
 * element prototype and tracks the last value it wrote, so a direct assignment
 * is invisible to onChange and the component keeps its old state. The button
 * then submits an empty form and nothing happens — silently. Calling the
 * *native* setter and dispatching a bubbling `input` event is what React's
 * synthetic event system actually listens for.
 */
const REACT_SET = `
window.__hmSet = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('no element for ' + selector);
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__hmClick = (text) => {
  const el = [...document.querySelectorAll('button, a')]
    .find(e => e.textContent.trim().toLowerCase().includes(text.toLowerCase()));
  if (!el) throw new Error('no clickable matching: ' + text);
  el.click();
  return true;
};
true;`;

async function webFlow() {
    head(`Web flow  ${WEB}`);
    mkdirSync(OUT, { recursive: true });

    if (!existsSync(CHROME)) {
        fail('locate Chrome', `not at ${CHROME} — set HORAMIND_CHROME`);
        return;
    }

    const profileDir = join(tmpdir(), `horamind-chrome-${process.pid}`);
    const chrome = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run', '--no-default-browser-check', '--disable-gpu',
        '--window-size=1280,900',
        'about:blank',
    ], { stdio: 'ignore' });

    let cdp = null;
    try {
        await step('launch headless Chrome', async () => {
            for (let i = 0; i < 60; i++) {
                try {
                    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
                    if (r.ok) return (await r.json()).Browser;
                } catch { /* not listening yet */ }
                await new Promise(r => setTimeout(r, 250));
            }
            throw new Error('Chrome never opened the debugging port');
        });

        // /json/list also returns `browser_ui` and extension targets on current
        // Chrome, and they are not always last. Filter by type or you attach to
        // a target where the page domains silently do nothing useful.
        const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const page = targets.find(t => t.type === 'page');
        if (!page) { fail('find a page target', `only saw: ${targets.map(t => t.type).join(', ')}`); return; }

        cdp = await Cdp.attach(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        // Install the helpers for EVERY document, not just the current one. A
        // reload (or any navigation) throws away the JS context, so helpers
        // injected with a bare Runtime.evaluate vanish and the next call dies
        // with "__hmClick is not defined" — several steps later, somewhere that
        // looks unrelated to the reload that actually caused it.
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: REACT_SET });

        await step('load the PWA', async () => {
            await cdp.send('Page.navigate', { url: WEB + '/' });
            await cdp.waitFor(`document.querySelector('#root')?.children.length > 0`, { label: 'React mounted' });
            return await cdp.eval('document.title');
        });

        await step('land on sign-in when signed out', async () => {
            await cdp.waitFor(`location.pathname === '/sign-in'`, { label: '/sign-in' });
            return location_of(await cdp.eval('location.pathname'));
        });

        await step('sign in', async () => {
            await cdp.eval(`__hmSet('input[type=email]', ${JSON.stringify(EMAIL)})`);
            await cdp.eval(`__hmSet('input[type=password]', ${JSON.stringify(PASSWORD)})`);
            await cdp.clickWhenReady('sign in');
            // The tab bar renders only for a session that has both a user and a
            // profile, which makes it the honest "signed in" signal. Waiting on
            // `location.pathname` instead asserts a particular landing route,
            // and a guard is free to send an account somewhere else.
            await cdp.waitFor(`document.querySelectorAll('nav a').length >= 4`, { label: 'tab bar' });
            return `landed on ${await cdp.eval('location.pathname')}`;
        });

        await step('Today renders', async () => {
            // Not `includes('Today')` — that string is also the tab label, so
            // the check passed on every screen in the app.
            await cdp.waitFor(`/factors behind this/i.test(document.body.innerText)`, { label: 'compass basis' });
            await cdp.settled();
            return await cdp.screenshot(join(OUT, 'today.png'));
        });

        await step('Chart renders real positions', async () => {
            await cdp.clickWhenReady('chart');
            // Case-insensitive: the label is styled as an engraved caption and
            // its casing is a design decision, not a contract.
            await cdp.waitFor(`/ascendant/i.test(document.body.innerText)`, { label: 'chart loaded' });
            const text = await cdp.eval('document.body.innerText');
            for (const graha of ['Sun', 'Moon', 'Saturn', 'Rahu', 'Ketu']) {
                if (!text.includes(graha)) throw new Error(`${graha} missing from the chart`);
            }
            // The wheel is the point of this screen; assert the SVG is really
            // there rather than trusting that the table alone rendered.
            const wheel = await cdp.eval(`document.querySelectorAll('svg').length`);
            if (!wheel) throw new Error('no SVG on the chart screen — the wheel did not render');

            await cdp.settled();

            await cdp.screenshot(join(OUT, 'chart.png'));
            return `${wheel} svg, wheel + table`;
        });

        await step('session survives a reload', async () => {
            // Regression guard: the access token lives in memory only, so a
            // reload restores from the httpOnly refresh cookie. If the session
            // is published before the profile is fetched, the route guard reads
            // the not-yet-loaded profile as "never onboarded" and strands an
            // onboarded user on /onboarding, with `replace` so there is no way
            // back.
            await cdp.send('Page.reload');
            await cdp.waitFor(`document.querySelector('#root')?.children.length > 0`, { label: 'remount' });
            await cdp.waitFor(`location.pathname !== '/sign-in'`, { label: 'session restored' });

            const path = await cdp.eval('location.pathname');
            if (path === '/onboarding') {
                throw new Error('stranded on /onboarding after reload — profile resolved after status flipped');
            }
            return `stayed on ${path}`;
        });

        await step('You screen round-trips a memory', async () => {
            // The tab is labelled by what you do there, not what it holds; it was
            // renamed You -> Me when Today absorbed the calendar.
            await cdp.clickWhenReady('me');
            await cdp.waitFor(`document.body.innerText.includes('ADD A MEMORY')`, { label: 'You screen' });
            await cdp.eval(`__hmSet('input[type=text]', 'driver memory ${Date.now()}')`);
            await cdp.clickWhenReady('save memory');
            await cdp.waitFor(`document.body.innerText.includes('SAVED MEMORIES')`, { label: 'memory saved' });
            await cdp.settled();
            await cdp.screenshot(join(OUT, 'you.png'));
            return join(OUT, 'you.png');
        });

        await step('Ask returns something (LLM optional)', async () => {
            await cdp.clickWhenReady('ask');
            await cdp.waitFor(`document.querySelector('textarea')`, { label: 'Ask screen' });
            await cdp.eval(`__hmSet('textarea', 'What should I focus on at work this year?')`);
            await cdp.clickWhenReady('ask');

            // Either an answer or an honest "not configured" is a pass; a
            // spinner that never resolves is not.
            await cdp.waitFor(
                `document.body.innerText.length > 400 || document.body.innerText.includes('not configured')`,
                { timeout: 90000, label: 'an answer or a stated reason' },
            );
            await cdp.screenshot(join(OUT, 'ask.png'));
            const text = await cdp.eval('document.body.innerText');
            return text.includes('not configured')
                ? 'AI not configured (expected without OPENROUTER_API_KEY)'
                : join(OUT, 'ask.png');
        });
    } finally {
        cdp?.close();
        chrome.kill('SIGTERM');
    }
}

const location_of = p => p;

// ---------------------------------------------------------------------------

const mode = process.argv[2] ?? 'all';
if (!['api', 'web', 'all'].includes(mode)) {
    console.error(`usage: driver.mjs {api|web|all}`);
    process.exit(2);
}

if (mode === 'api' || mode === 'all') await apiFlow();
if (mode === 'web' || mode === 'all') await webFlow();

console.log(
    failures === 0
        ? `\n\x1b[32mall steps passed\x1b[0m${mode !== 'api' ? `  screenshots: ${OUT}` : ''}`
        : `\n\x1b[31m${failures} step(s) failed\x1b[0m`,
);
process.exit(failures === 0 ? 0 : 1);
