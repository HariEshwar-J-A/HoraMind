import { DateTime } from 'luxon';

import type { Env } from '../config/env.js';
import type { Sql } from '../db/client.js';
import type { Tier } from '@horamind/shared';

import type { ProfileRow } from '../repos/profiles.js';
import { contextFor, panchanga } from './charts.js';
import { buildFacts } from './facts.js';
import * as openrouter from '../lib/openrouter.js';
import { modelFor } from './interpret.js';

/**
 * The daily compass — one day's do's and don'ts.
 *
 * Two decisions keep this from becoming the most expensive feature in the app:
 *
 *   1. **Cached by (profile, local date).** It is a function of the chart and
 *      the day, so two requests on the same day must return the same answer.
 *      Anything else undermines the advice: a user who reloads and reads
 *      something different learns the app is guessing.
 *
 *   2. **Computed lazily on first open, never by a nightly job.** A per-user
 *      daily model call across a free tier is the single easiest way to make
 *      this unaffordable — most users do not open the app most days, and a cron
 *      pays for all of them anyway.
 *
 * Most of the content is deterministic. Panchanga, the live dasha, the transit
 * houses from the natal Moon and the Ashtakavarga bindus are all computed; the
 * model only phrases them. That is also why the basis is returned alongside the
 * prose — the advice should be inspectable, not taken on faith.
 */

export interface CompassPayload {
    date: string;
    headline: string;
    dos: string[];
    donts: string[];
    basis: Record<string, unknown>;
}

/** The user's local date, which is what "today" means to them. */
export function localDate(timezone: string, now = DateTime.now()): string {
    return now.setZone(timezone).toISODate() ?? now.toUTC().toISODate()!;
}

export async function getCached(
    sql: Sql,
    profileId: string,
    date: string,
): Promise<CompassPayload | null> {
    const [row] = await sql<{ payload: CompassPayload }[]>`
        SELECT payload FROM daily_compass
         WHERE birth_profile_id = ${profileId} AND local_date = ${date}`;
    return row?.payload ?? null;
}

async function cache(
    sql: Sql,
    profileId: string,
    date: string,
    payload: CompassPayload,
    model: string,
): Promise<void> {
    // Two requests can race on first open of the day. The upsert makes the
    // loser adopt the winner's answer rather than overwrite it, so the day's
    // guidance stays stable.
    await sql`
        INSERT INTO daily_compass (birth_profile_id, local_date, payload, model)
        VALUES (${profileId}, ${date}, ${sql.json(payload as never)}, ${model})
        ON CONFLICT (birth_profile_id, local_date) DO NOTHING`;
}

/**
 * Render one limb of the panchanga as text.
 *
 * `panchanga()` returns each limb as `{ index, name, percent }` — a shape
 * `String()` turns into `"[object Object]"`. That is not a display bug: the
 * basis below is serialised straight into the model's prompt, so coercion
 * quietly deleted the tithi, nakshatra, yoga, karana and weekday from every
 * reading while leaving prose that still looked authoritative.
 *
 * The nakshatra's pada is kept because it is load-bearing — it selects the
 * dasha sub-period — and dropped for limbs that have none. `percent` is
 * deliberately discarded: "39% elapsed" invites the model to predict when a
 * tithi turns, which is a claim about the day the basis has not made.
 */
export function limbName(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || typeof value !== 'object') return 'unknown';

    const limb = value as { name?: unknown; pada?: unknown };
    if (typeof limb.name !== 'string' || limb.name.length === 0) return 'unknown';

    return typeof limb.pada === 'number'
        ? `${limb.name} (pada ${limb.pada})`
        : limb.name;
}

/** The deterministic half. Computed whether or not a model is ever called. */
export function computeBasis(profile: ProfileRow, date: string, timezone: string) {
    const at = DateTime.fromISO(date, { zone: timezone }).set({ hour: 9 });
    const natal = contextFor(profile);
    const facts = buildFacts(profile, at, 3);

    // Today's panchanga, not the birth chart's.
    //
    // `contextFor` builds the *birth* moment, so passing it here described the
    // day someone was born and labelled it today — a compass whose weekday,
    // tithi and nakshatra never changed for the life of the account. The
    // transits above were already computed at `at`; only this was left behind.
    //
    // The birth coordinates are kept deliberately. Tithi, yoga and karana are
    // functions of the Sun–Moon relationship and barely move with the observer,
    // and vara depends on sunrise, which `panchanga` already approximates.
    const today = { ...natal, dt: at };

    // PanchangaResult has no index signature; the fields read here are optional
    // by intent, so widen through unknown rather than narrow the shape.
    const pan = panchanga(today) as unknown as Record<string, unknown>;

    const moving = facts.transits.planets
        .filter(p => ['Jupiter', 'Saturn', 'Mars', 'Rahu', 'Ketu'].includes(p.name))
        .map(p => `${p.name} in ${p.signName}, house ${p.houseFromMoon} from the Moon `
                + `(${p.savBindus} bindus)${p.retrograde ? ', retrograde' : ''}`);

    return {
        tithi: limbName(pan.tithi),
        nakshatra: limbName(pan.nakshatra),
        yoga: limbName(pan.yoga),
        karana: limbName(pan.karana),
        vara: limbName(pan.vara),
        currentDasha: facts.dashaStack.map(d => `${d.levelName}: ${d.lord}`),
        saturnCycle: facts.transits.saturnCycle,
        notableTransits: moving,
        birthTimeAccuracy: profile.timeAccuracy,
    };
}

export async function generate(
    env: Env,
    sql: Sql,
    profile: ProfileRow,
    tier: Tier,
    timezone: string,
    date: string,
): Promise<{ payload: CompassPayload; fromCache: boolean; usage: openrouter.Usage | null }> {
    const existing = await getCached(sql, profile.id, date);
    if (existing) return { payload: existing, fromCache: true, usage: null };

    const basis = computeBasis(profile, date, timezone);

    const result = await openrouter.complete(env, {
        model: modelFor(env, tier),
        temperature: 0.5,
        maxTokens: 700,
        messages: [
            {
                role: 'system',
                content:
                    'You write a one-day Vedic astrology compass. You are given computed facts '
                    + 'for the day; phrase them, do not extend them.\n\n'
                    + 'Reply as JSON only, with this exact shape:\n'
                    + '{"headline": string, "dos": string[], "donts": string[]}\n\n'
                    + 'Rules:\n'
                    + '- headline: one sentence, under 90 characters, about the day\'s texture.\n'
                    + '- dos and donts: 2 to 4 items each, concrete and actionable today.\n'
                    + '- No predictions of specific events. No medical, financial or legal advice.\n'
                    + '- Never say the day is dangerous, cursed, or fated. A difficult transit '
                    + 'means "expect friction on X", not "avoid leaving the house".\n'
                    + '- If birthTimeAccuracy is not "exact", avoid house-based claims.',
            },
            { role: 'user', content: JSON.stringify(basis, null, 2) },
        ],
    });

    const parsed = parseCompass(result.content);

    const payload: CompassPayload = {
        date,
        headline: parsed.headline,
        dos: parsed.dos,
        donts: parsed.donts,
        basis,
    };

    await cache(sql, profile.id, date, payload, result.model);

    // Return the row that actually landed. Under a race the other request's
    // answer is authoritative, and returning our discarded one would show the
    // user something the cache will never serve again.
    const stored = await getCached(sql, profile.id, date);
    return { payload: stored ?? payload, fromCache: false, usage: result.usage };
}

/**
 * Parse the model's JSON, tolerantly.
 *
 * Models wrap JSON in prose or fences often enough that strict parsing would
 * fail a meaningful share of days. A compass that degrades to a plain headline
 * is far better than an error page, so every failure path still yields
 * something displayable.
 */
export function parseCompass(content: string | null): {
    headline: string; dos: string[]; donts: string[];
} {
    const fallback = {
        headline: 'A day to proceed steadily.',
        dos: [] as string[],
        donts: [] as string[],
    };
    if (!content) return fallback;

    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
    const candidate = fenced?.[1] ?? content;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return fallback;

    try {
        const obj = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
        const strings = (v: unknown): string[] =>
            Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];

        return {
            headline: typeof obj.headline === 'string' && obj.headline.trim()
                ? obj.headline.trim()
                : fallback.headline,
            dos: strings(obj.dos),
            donts: strings(obj.donts),
        };
    } catch {
        return fallback;
    }
}
