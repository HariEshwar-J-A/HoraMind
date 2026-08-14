#!/usr/bin/env node
/** UI audit: every screen, every section, at a phone width and a desktop width. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/hm-audit';
const WIDTH = Number(process.argv[3] ?? 1280);
const HEIGHT = Number(process.argv[4] ?? 900);
const PORT = Number(process.argv[5] ?? 9470);

mkdirSync(OUT, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/hm-audit-profile-${PORT}`,
    '--no-first-run', '--disable-gpu', `--window-size=${WIDTH},${HEIGHT}`,
    '--force-device-scale-factor=2', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* waiting */ }
    await sleep(250);
}

const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async expr =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

await send('Page.enable');
await send('Runtime.enable');

const shots = [];
async function shot(name, { scroll = 0, wait = 1200 } = {}) {
    await ev(`window.scrollTo(0, ${scroll})`);
    await sleep(wait);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}/${name}.png`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    // Overflow is the defect a screenshot hides: the page looks fine and the
    // content is off the right edge.
    const overflow = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    const h = await ev('document.documentElement.scrollHeight');
    shots.push({ name, overflowX: overflow, pageHeight: h });
    return file;
}

const click = async text => {
    await ev(`[...document.querySelectorAll('button,a')].find(e => new RegExp(${JSON.stringify(text)}, 'i').test(e.textContent.trim()))?.click(); 1`);
    await sleep(1600);
};

await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2800);
await shot('01-signin');

await ev(`(() => {
  const s = (q, v) => { const el = document.querySelector(q);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  s('input[type=email]', 'tester@example.com');
  s('input[type=password]', 'a-very-strong-test-password-123');
  return 1; })()`);
await click('sign in');
await sleep(2500);

await shot('02-today-top');
await shot('03-today-scrolled', { scroll: 500 });

await click('^Chart$');
await sleep(2600);
await shot('04-chart-north');
await shot('05-chart-dial', { scroll: 560 });
await shot('06-chart-table', { scroll: 1150 });

await click('South Indian');
await sleep(1800);
await shot('07-chart-south');
await click('North Indian');
await sleep(1200);

await click('^Days$');
await sleep(2600);
await shot('08-calendar');
await shot('09-calendar-scrolled', { scroll: 420 });

await click('^Ask$');
await sleep(2000);
await shot('10-ask-empty');

await click('^You$');
await sleep(2200);
await shot('11-you-top');
await shot('12-you-scrolled', { scroll: 420 });

await click('the long reading');
await sleep(2600);
await shot('13-life-top');
await shot('14-life-scrolled', { scroll: 700 });
await shot('15-life-deep', { scroll: 1500 });

console.log(`\n${WIDTH}x${HEIGHT}`);
for (const s of shots) {
    const flag = s.overflowX > 1 ? `  ⚠ HORIZONTAL OVERFLOW ${s.overflowX}px` : '';
    console.log(`  ${s.name.padEnd(24)} h=${String(s.pageHeight).padStart(5)}${flag}`);
}

ws.close();
chrome.kill('SIGTERM');
