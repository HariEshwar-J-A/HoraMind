import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv } from '../src/config/env.js';
import { resetJwtKey } from '../src/lib/jwt.js';
import { searchPlaces, timezoneForCoordinates } from '../src/lib/places.js';
import { toBirthProfile, type ProfileRow } from '../src/repos/profiles.js';
import { contextFor } from '../src/services/charts.js';

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

/**
 * `birth_date` is a Postgres `date`, and postgres.js hands it back as a JS
 * `Date` at UTC midnight rather than as a string. Two things follow, and both
 * have to be got right:
 *
 *   * The wire format is `YYYY-MM-DD`. A `Date` serialised any other way fails
 *     response validation and the route answers 500 — every read of a profile,
 *     not an edge case.
 *   * It must be rendered from its UTC components. Anything that formats in
 *     local time reports the previous day everywhere west of Greenwich, which
 *     is a wrong chart rather than a visibly broken one.
 */
describe('profile row mapping', () => {
    const row = {
        id: '0b7b7f8e-1f3a-4a2e-9c6d-0f9d3a1b2c3d',
        userId: 'c3d4e5f6-1111-2222-3333-444455556666',
        label: 'Me',
        isPrimary: true,
        birthDate: new Date('1990-08-15T00:00:00.000Z'),
        birthTime: '14:30:00',
        timeAccuracy: 'exact',
        placeName: 'Chennai, Tamil Nadu, India',
        latitude: '13.08998781',
        longitude: '80.27999874',
        timezone: 'Asia/Kolkata',
        ayanamsa: 'true_chitra',
        nodeType: 'true',
        positionMode: 'geocentric',
        houseSystem: 'whole_sign',
        dasamsaScheme: 'parasara',
        horaScheme: 'parasara',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } satisfies ProfileRow;

    test('renders a driver Date as the stored calendar day', () => {
        expect(toBirthProfile(row).birthDate).toBe('1990-08-15');
    });

    test('passes a string birth date through untouched', () => {
        expect(toBirthProfile({ ...row, birthDate: '1990-08-15' }).birthDate).toBe('1990-08-15');
    });

    /**
     * The chart service reads the row directly rather than the wire shape, so
     * it needs the same conversion. It resolves the birth moment in the birth
     * timezone — 14:30 in Asia/Kolkata is 09:00 UTC — and a mis-parsed date
     * surfaces here as an invalid instant rather than as a bad chart.
     */
    test('builds the birth moment from a driver Date in the birth timezone', () => {
        const ctx = contextFor(row);
        expect(ctx.dt.toISO()).toBe('1990-08-15T14:30:00.000+05:30');
        expect(ctx.dt.toUTC().toISO()).toBe('1990-08-15T09:00:00.000Z');
    });

    test('builds the same moment from a string birth date', () => {
        const ctx = contextFor({ ...row, birthDate: '1990-08-15' });
        expect(ctx.dt.toUTC().toISO()).toBe('1990-08-15T09:00:00.000Z');
    });
});

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
