import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv } from '../src/config/env.js';

/**
 * Startup smoke tests.
 *
 * These deliberately avoid a database. The point is to prove the process can
 * come up, refuse bad configuration, and answer a liveness probe — the three
 * things that decide whether a deployment is even worth investigating when it
 * fails. Anything requiring Postgres belongs in an integration suite.
 */

const TEST_ENV = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

describe('environment validation', () => {
    beforeAll(() => resetEnv());

    test('rejects a missing JWT secret rather than starting insecurely', () => {
        resetEnv();
        const { JWT_SECRET: _omitted, ...withoutSecret } = TEST_ENV;
        expect(() => loadEnv(withoutSecret)).toThrow(/JWT_SECRET/);
    });

    test('rejects a JWT secret that is too short to be worth having', () => {
        resetEnv();
        expect(() => loadEnv({ ...TEST_ENV, JWT_SECRET: 'short' })).toThrow(/at least 32/);
    });

    test('rejects a malformed database URL', () => {
        resetEnv();
        expect(() => loadEnv({ ...TEST_ENV, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
    });

    test('applies documented defaults', () => {
        resetEnv();
        const env = loadEnv(TEST_ENV);
        expect(env.PORT).toBe(8080);
        expect(env.CHROMA_COLLECTION).toBe('santhanam_source_of_truth');
        // The engine defaults must match what node-jhora verified against JHora.
        expect(env.OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    });

    /**
     * `.env.example` documents these as `false`, and every deployment copies it.
     * A naive string-to-boolean reads any non-empty string as true, which turns
     * the documented value into its opposite: TLS demanded of a database that
     * does not offer it, and every client IP reading as the proxy's so all
     * users share one rate-limit bucket. Both fail in ways that look like
     * something else.
     */
    test('reads a documented "false" as false, not as a non-empty string', () => {
        resetEnv();
        const env = loadEnv({ ...TEST_ENV, DATABASE_SSL: 'false', TRUST_PROXY: 'false' });
        expect(env.DATABASE_SSL).toBe(false);
        expect(env.TRUST_PROXY).toBe(false);
    });

    test('accepts the usual spellings of true', () => {
        resetEnv();
        const env = loadEnv({ ...TEST_ENV, DATABASE_SSL: 'true', TRUST_PROXY: '1' });
        expect(env.DATABASE_SSL).toBe(true);
        expect(env.TRUST_PROXY).toBe(true);
    });

    test('rejects a boolean it cannot interpret rather than guessing', () => {
        resetEnv();
        expect(() => loadEnv({ ...TEST_ENV, DATABASE_SSL: 'ture' })).toThrow(/DATABASE_SSL/);
    });
});

describe('server', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        resetEnv();
        app = await buildServer(loadEnv(TEST_ENV));
        await app.ready();
    });

    afterAll(async () => { await app?.close(); });

    test('liveness responds without touching any dependency', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'ok' });
    });

    test('unknown routes return the standard error envelope', async () => {
        const res = await app.inject({ method: 'GET', url: '/nope' });
        expect(res.statusCode).toBe(404);
        const body = res.json();
        expect(body.error.code).toBe('NOT_FOUND');
        // Every error carries a request id; without it, a user report of "it
        // broke" cannot be matched to a log line.
        expect(body.error.requestId).toBeTruthy();
    });

    test('security headers are present', async () => {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('an OpenAPI document is generated', async () => {
        const spec = app.swagger();
        expect(spec.openapi).toBeTruthy();
        expect(spec.paths?.['/health']).toBeTruthy();
    });
});
