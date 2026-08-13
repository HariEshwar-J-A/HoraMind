import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';

import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv } from '../src/config/env.js';
import { resetJwtKey } from '../src/lib/jwt.js';
import { estimateTokens, estimateMessageTokens } from '../src/services/compaction.js';
import { parseCompass, localDate, limbName } from '../src/services/compass.js';

/**
 * Chat and compass tests.
 *
 * The compass parser gets the most attention here because it sits between a
 * model's free-form output and something a user reads. Models wrap JSON in
 * prose and fences often enough that strict parsing would fail a meaningful
 * share of days, and a compass that degrades to a plain headline is far better
 * than an error page.
 */

const TEST_ENV = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

describe('token estimation', () => {
    test('scales with length', () => {
        expect(estimateTokens('a'.repeat(360))).toBeGreaterThan(estimateTokens('a'.repeat(36)));
    });

    test('errs high rather than low', () => {
        // Compacting slightly early costs one extra summary. Compacting late
        // means the provider rejects the request, so the safe direction is up.
        const text = 'The Moon is in Gemini and Saturn transits the tenth house.';
        const words = text.split(/\s+/).length;
        expect(estimateTokens(text)).toBeGreaterThan(words);
    });

    test('message overhead is counted, not just text', () => {
        const withText = estimateMessageTokens([{ content: 'hello' }]);
        const empty = estimateMessageTokens([{ content: '' }]);
        // Role and delimiters cost tokens even when the content is empty.
        expect(empty).toBeGreaterThan(0);
        expect(withText).toBeGreaterThan(empty);
    });

    test('a null message body does not throw', () => {
        expect(() => estimateMessageTokens([{ content: null }])).not.toThrow();
    });
});

describe('compass parsing', () => {
    const good = '{"headline":"Steady progress favoured.","dos":["Finish what is open"],"donts":["Start something new"]}';

    test('parses a clean JSON reply', () => {
        const out = parseCompass(good);
        expect(out.headline).toBe('Steady progress favoured.');
        expect(out.dos).toEqual(['Finish what is open']);
    });

    test('parses JSON wrapped in a code fence', () => {
        expect(parseCompass('```json\n' + good + '\n```').headline)
            .toBe('Steady progress favoured.');
    });

    test('parses JSON buried in prose', () => {
        const out = parseCompass(`Here is your compass for today:\n\n${good}\n\nHope that helps!`);
        expect(out.dos).toHaveLength(1);
    });

    test('degrades to a usable headline rather than throwing', () => {
        // Every failure path must still yield something displayable.
        for (const bad of ['not json at all', '{"broken":', '', '{}']) {
            const out = parseCompass(bad);
            expect(out.headline.length).toBeGreaterThan(0);
            expect(Array.isArray(out.dos)).toBe(true);
        }
    });

    test('handles a null completion', () => {
        expect(parseCompass(null).headline.length).toBeGreaterThan(0);
    });

    test('caps list length so one verbose reply cannot dominate the screen', () => {
        const many = JSON.stringify({
            headline: 'x',
            dos: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            donts: [],
        });
        expect(parseCompass(many).dos.length).toBeLessThanOrEqual(4);
    });

    test('drops non-string list entries instead of rendering objects', () => {
        const mixed = JSON.stringify({ headline: 'x', dos: ['ok', 42, null, { a: 1 }], donts: [] });
        expect(parseCompass(mixed).dos).toEqual(['ok']);
    });
});

/**
 * The engine returns each limb of the panchanga as `{ index, name, ... }`, not
 * as a string. Coercing one with `String()` yields `"[object Object]"`, and the
 * basis is not merely displayed — it *is* the model's entire input, so the
 * failure is not a cosmetic one. It silently strips the tithi, the nakshatra,
 * the yoga, the karana and the weekday out of a reading that is supposed to be
 * computed rather than improvised, and the output still reads perfectly well.
 */
describe('compass basis', () => {
    test('names each limb rather than stringifying the object', () => {
        expect(limbName({ index: 13, name: 'Vyaghata' })).toBe('Vyaghata');
        expect(limbName({ index: 25, name: 'Krishna 10', percent: 39.5 })).toBe('Krishna 10');
    });

    test('keeps the pada, which is what selects the dasha sub-period', () => {
        expect(limbName({ index: 4, name: 'Rohini', pada: 4, percent: 84.9 })).toBe('Rohini (pada 4)');
    });

    test('passes a plain string through', () => {
        expect(limbName('Budhavara')).toBe('Budhavara');
    });

    test('never emits [object Object], whatever it is handed', () => {
        for (const input of [{ index: 1 }, {}, null, undefined, 42]) {
            expect(limbName(input)).not.toContain('[object Object]');
        }
    });
});

describe('compass date', () => {
    test('"today" is the user\'s date, not the server\'s', () => {
        // 20:00 UTC is already tomorrow in Kolkata. Serving yesterday's compass
        // to someone whose day has started is the whole failure this prevents.
        const at = DateTime.fromISO('2026-08-10T20:00:00Z');
        expect(localDate('Asia/Kolkata', at)).toBe('2026-08-11');
        expect(localDate('UTC', at)).toBe('2026-08-10');
    });
});

describe('chat and compass routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        resetEnv();
        resetJwtKey();
        app = await buildServer(loadEnv(TEST_ENV));
        await app.ready();
    });

    afterAll(async () => { await app?.close(); });

    test.each([
        ['GET',    '/v1/chats'],
        ['POST',   '/v1/chats'],
        ['GET',    '/v1/chats/expiring'],
        ['GET',    '/v1/compass'],
        ['POST',   '/v1/interpret'],
    ])('%s %s requires authentication', async (method, url) => {
        const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
        expect(res.statusCode).toBe(401);
    });

    test('chat endpoints are documented', async () => {
        const spec = app.swagger();
        expect(spec.paths?.['/v1/chats']).toBeTruthy();
        expect(spec.paths?.['/v1/chats/{id}/messages']).toBeTruthy();
        expect(spec.paths?.['/v1/compass']).toBeTruthy();
    });

    test('an expiry warning endpoint exists', async () => {
        // Chats are hard-deleted after 7 days. Without a way to warn first,
        // the first a user knows of it is that their conversation is gone.
        expect(app.swagger().paths?.['/v1/chats/expiring']).toBeTruthy();
    });

    test('the retention scheduler does not run under test', () => {
        // It is registered only outside NODE_ENV=test, so a suite never starts
        // an hourly timer that outlives the assertions it was built for.
        expect(app.hasDecorator('runRetentionNow')).toBe(false);
    });
});
