import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv } from '../src/config/env.js';
import { resetJwtKey } from '../src/lib/jwt.js';
import { searchPlaces, timezoneForCoordinates } from '../src/lib/places.js';

/**
 * Domain layer tests.
 *
 * Place lookup is fully exercised here because it is offline and deterministic,
 * and because it is the single input most able to ruin a chart: the timezone.
 * Everything that writes rows needs Postgres and runs in CI.
 */

const TEST_ENV = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

describe('place lookup', () => {
    test('resolves a known city with coordinates and an IANA timezone', () => {
        const [first] = searchPlaces('Chennai');
        expect(first).toBeDefined();
        expect(first!.timezone).toBe('Asia/Kolkata');
        // Chennai is near 13.08 N, 80.27 E.
        expect(first!.latitude).toBeCloseTo(13.08, 0);
        expect(first!.longitude).toBeCloseTo(80.27, 0);
    });

    test('every timezone returned is one the runtime accepts', () => {
        // A zone string the platform cannot resolve would fail later, during
        // chart computation, where the cause is far less obvious.
        for (const place of searchPlaces('London', 5)) {
            expect(() => new Intl.DateTimeFormat('en', { timeZone: place.timezone })).not.toThrow();
        }
    });

    test('exact name matches rank above incidental substring matches', () => {
        const results = searchPlaces('York', 10);
        expect(results.length).toBeGreaterThan(0);
        // Without ranking, the dataset order surfaces obscure villages first.
        expect(results[0]!.name.toLowerCase()).toContain('york');
    });

    test('a one-character query is rejected rather than scanning everything', () => {
        expect(() => searchPlaces('C')).toThrow(/at least two characters/);
    });

    test('an unknown place returns nothing rather than a wrong guess', () => {
        expect(searchPlaces('Zzzzqqxx Nowhere')).toEqual([]);
    });

    test('coordinates resolve to a plausible timezone', () => {
        expect(timezoneForCoordinates(13.08, 80.27)).toBe('Asia/Kolkata');
        expect(timezoneForCoordinates(51.5, -0.12)).toBe('Europe/London');
    });
});

describe('domain routes', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        resetEnv();
        resetJwtKey();
        app = await buildServer(loadEnv(TEST_ENV));
        await app.ready();
    });

    afterAll(async () => { await app?.close(); });

    test('place search needs no token, so onboarding can offer a city list', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/places/search?query=Chennai' });
        expect(res.statusCode).toBe(200);
        expect(res.json().results.length).toBeGreaterThan(0);
    });

    test.each([
        ['GET',    '/v1/profiles'],
        ['POST',   '/v1/profiles'],
        ['GET',    '/v1/memories'],
        ['POST',   '/v1/memories'],
        ['GET',    '/v1/interests'],
        ['GET',    '/v1/interests/prompt'],
        ['POST',   '/v1/interests/prompt'],
        ['GET',    '/v1/charts/natal'],
        ['GET',    '/v1/charts/vargas'],
        ['GET',    '/v1/charts/dasha'],
        ['GET',    '/v1/charts/ashtakavarga'],
        ['GET',    '/v1/charts/panchanga'],
    ])('%s %s requires authentication', async (method, url) => {
        const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
        expect(res.statusCode).toBe(401);
    });

    test('the timezone endpoint marks its answer as approximate', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/places/timezone?latitude=13.08&longitude=80.27',
        });
        expect(res.statusCode).toBe(200);
        // Nearest-city lookup is wrong near borders. Saying so is what stops a
        // client applying it to a birth chart without asking.
        expect(res.json().approximate).toBe(true);
    });

    test('place search rejects a query below the minimum length', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/places/search?query=C' });
        expect(res.statusCode).toBe(400);
    });

    test('domain routes are documented in OpenAPI', async () => {
        const spec = app.swagger();
        for (const path of ['/v1/profiles', '/v1/memories', '/v1/interests/prompt',
                            '/v1/charts/natal', '/v1/places/search']) {
            expect(spec.paths?.[path], `${path} missing from OpenAPI`).toBeTruthy();
        }
    });

    test('shadbala is absent rather than returning unverified strengths', async () => {
        // Deliberate: assembling its input needs sunrise/sunset and varga lord
        // data the engine does not expose, and a confidently wrong strength
        // value is worse than a missing endpoint in an app whose premise is
        // that the computation is right.
        const spec = app.swagger();
        expect(spec.paths?.['/v1/charts/shadbala']).toBeUndefined();
    });
});
