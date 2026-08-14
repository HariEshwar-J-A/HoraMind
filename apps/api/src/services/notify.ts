import { DateTime } from 'luxon';
import type { FastifyBaseLogger } from 'fastify';
import type { NotificationKind } from '@horamind/shared';

import type { Sql } from '../db/client.js';
import type { Env } from '../config/env.js';
import * as notes from '../repos/notifications.js';
import { contextFor, natalChart } from './charts.js';
import { dashaStackAt } from './facts.js';
import { inputsHash } from './life.js';
import * as mem from '../repos/memories.js';

/**
 * Notification detection and delivery.
 *
 * The bar: it must tell someone something they could not have known without
 * it. "Your daily compass is ready" fails that test — the app is right there.
 * A dasha boundary, Saturn changing sign, or a life reading whose inputs have
 * moved, do not.
 *
 * Quiet hours are enforced here, in the user's timezone, at send time. The
 * in-app row is always written (the centre is not a buzz); only a push is
 * withheld.
 */

const SIGN = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
              'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

export function inQuietHours(
    nowMinutes: number,
    from: number | null,
    to: number | null,
): boolean {
    if (from === null || to === null) return false;
    if (from === to) return false;
    if (from < to) return nowMinutes >= from && nowMinutes < to;
    return nowMinutes >= from || nowMinutes < to;
}

export function kindEnabled(kinds: Record<string, boolean>, kind: NotificationKind): boolean {
    if (kind === 'system') return kinds.system !== false;
    return kinds[kind] === true;
}

function minutesInZone(zone: string): number {
    const now = DateTime.now().setZone(zone);
    if (!now.isValid) return DateTime.now().hour * 60 + DateTime.now().minute;
    return now.hour * 60 + now.minute;
}

export async function emit(
    sql: Sql,
    env: Env,
    log: FastifyBaseLogger,
    input: {
        userId: string;
        kind: NotificationKind;
        title: string;
        body: string;
        href?: string | null;
        timezone: string;
    },
): Promise<void> {
    const prefs = await notes.getPrefs(sql, input.userId);
    if (!kindEnabled(prefs.kinds, input.kind)) return;
    if (await notes.recentlyEmitted(sql, input.userId, input.kind, input.title)) return;

    await notes.insertNotification(sql, input);

    const quiet = inQuietHours(minutesInZone(input.timezone), prefs.quietFrom, prefs.quietTo);
    if (quiet) return;

    await sendPush(sql, env, log, input.userId, input.title, input.body);
}

async function sendPush(
    sql: Sql,
    env: Env,
    log: FastifyBaseLogger,
    userId: string,
    title: string,
    body: string,
): Promise<void> {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;

    const subs = await notes.listPush(sql, userId);
    if (subs.length === 0) return;

    // Dynamic import so a missing `web-push` never takes the API down; in-app
    // notifications are the real product, push is a bonus.
    try {
        const webpush = await import('web-push' as string) as {
            default: {
                setVapidDetails: (s: string, pub: string, priv: string) => void;
                sendNotification: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
            };
        };
        webpush.default.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        const payload = JSON.stringify({ title, body });
        for (const sub of subs) {
            try {
                await webpush.default.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload,
                );
            } catch (err) {
                log.warn({ err, endpoint: sub.endpoint.slice(0, 48) }, 'push send failed');
            }
        }
    } catch (err) {
        log.debug({ err }, 'web-push not installed; skipping push');
    }
}

/**
 * Walk every primary profile, compare today's sky to the last snapshot, emit
 * on difference.
 *
 * Failures on a single profile are logged and skipped: one bad birth time must
 * not cancel the rest of the hour.
 */
export async function detectChanges(
    sql: Sql,
    env: Env,
    log: FastifyBaseLogger,
): Promise<{ scanned: number; emitted: number }> {
    const watched = await notes.listWatched(sql);
    let emitted = 0;

    for (const item of watched) {
        try {
            const n = await inspectOne(sql, env, log, item);
            emitted += n;
        } catch (err) {
            log.warn({ err, userId: item.userId }, 'notification detect failed for profile');
        }
    }

    return { scanned: watched.length, emitted };
}

async function inspectOne(
    sql: Sql,
    env: Env,
    log: FastifyBaseLogger,
    item: notes.WatchRow,
): Promise<number> {
    const ctx = contextFor(item.profile);
    const now = DateTime.now().setZone(item.timezone);
    const stack = dashaStackAt(ctx, now, 3);
    const dashaKey = stack.map(d => String(d.lord)).join('/');

    const natal = natalChart(ctx);
    const moon = natal.planets.find(p => p.name === 'Moon');
    const transiting = natalChart({ ...ctx, dt: now });
    const saturn = transiting.planets.find(p => p.name === 'Saturn');
    const jupiter = transiting.planets.find(p => p.name === 'Jupiter');

    const saturnSign = saturn?.sign ?? null;
    const jupiterSign = jupiter?.sign ?? null;

    // Sade Sati: Saturn in the 12th, 1st or 2nd from the natal Moon.
    let sadeSati = false;
    if (moon && saturnSign !== null) {
        const fromMoon = ((((saturnSign - moon.sign) % 12) + 12) % 12) + 1;
        sadeSati = fromMoon === 12 || fromMoon === 1 || fromMoon === 2;
    }

    const prev = await notes.getSnapshot(sql, item.profile.id);
    let count = 0;

    const send = async (
        kind: NotificationKind,
        title: string,
        body: string,
        href: string,
    ) => {
        await emit(sql, env, log, {
            userId: item.userId, kind, title, body, href, timezone: item.timezone,
        });
        count += 1;
    };

    if (prev && prev.dashaStack !== dashaKey && dashaKey.length > 0) {
        const lords = dashaKey.split('/');
        await send(
            'dasha_change',
            `${lords[0] ?? 'A'} period is turning`,
            `Your current dasha stack is now ${dashaKey.replaceAll('/', ' → ')}.`,
            '/chart',
        );
    }

    if (prev && prev.saturnSign !== null && saturnSign !== null && prev.saturnSign !== saturnSign) {
        await send(
            'transit',
            `Saturn has entered ${SIGN[saturnSign - 1] ?? 'a new sign'}`,
            'Saturn changing sign is slow enough that it is worth noticing. Open the chart to see where.',
            '/chart',
        );
    }

    if (prev && prev.jupiterSign !== null && jupiterSign !== null && prev.jupiterSign !== jupiterSign) {
        await send(
            'transit',
            `Jupiter has entered ${SIGN[jupiterSign - 1] ?? 'a new sign'}`,
            'Jupiter changing sign reshapes the year more than any other transit this app tracks.',
            '/chart',
        );
    }

    if (prev && prev.sadeSati !== sadeSati) {
        await send(
            'transit',
            sadeSati ? 'Sade Sati has begun' : 'Sade Sati has ended',
            sadeSati
                ? 'Saturn is now in the 12th, 1st or 2nd from your natal Moon. That is the classical window, not a sentence.'
                : 'Saturn has left the houses around your natal Moon. The window has closed.',
            '/chart',
        );
    }

    await notes.upsertSnapshot(sql, {
        birthProfileId: item.profile.id,
        dashaStack: dashaKey,
        saturnSign,
        jupiterSign,
        sadeSati,
    });

    // Life reading whose inputs have moved, and it has been more than a week.
    const [life] = await sql<{ inputsHash: Buffer; updatedAt: Date }[]>`
        SELECT inputs_hash, updated_at FROM life_analyses
         WHERE birth_profile_id = ${item.profile.id} AND status = 'ready'`;
    if (life) {
        const [memories, interests] = await Promise.all([
            mem.listMemories(sql, item.userId),
            mem.listInterests(sql, item.userId),
        ]);
        const current = inputsHash({
            profile: item.profile,
            memories: memories.map(mem.toMemory),
            interests: interests.map(mem.toInterest),
        });
        const ageDays = DateTime.now().diff(DateTime.fromJSDate(life.updatedAt), 'days').days;
        if (!current.equals(life.inputsHash) && ageDays >= 7) {
            await send(
                'life_stale',
                'Your long reading is out of date',
                'Memories or interests have changed since it was written. Rewrite it when you have a minute.',
                '/you/life',
            );
        }
    }

    return count;
}
