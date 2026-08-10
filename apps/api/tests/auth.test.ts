import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv, type Env } from '../src/config/env.js';
import { signAccessToken, verifyAccessToken, resetJwtKey } from '../src/lib/jwt.js';
import {
    hashPassword, verifyPassword, generateOpaqueToken, hashToken, digestsEqual, hashIp,
} from '../src/lib/crypto.js';

/**
 * Authentication unit tests.
 *
 * These cover the parts that are wrong-able without a database: password
 * hashing, token signing and verification, and whether protected routes are
 * actually protected. Flows that write rows — registration, rotation, reuse
 * detection — need Postgres and run as integration tests in CI.
 */

const TEST_ENV_VARS = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    JWT_ISSUER: 'horamind',
    JWT_AUDIENCE: 'horamind-app',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

let env: Env;

beforeAll(() => {
    resetEnv();
    resetJwtKey();
    env = loadEnv(TEST_ENV_VARS);
});

describe('password hashing', () => {
    test('a password verifies against its own hash', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    }, 20_000);

    test('a wrong password does not verify', async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
    }, 20_000);

    test('the same password hashes differently every time', async () => {
        // Distinct salts. Without them, identical passwords produce identical
        // hashes and one leaked table reveals which users share a password.
        const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
        expect(a).not.toBe(b);
    }, 20_000);

    test('it is argon2id, not another variant', async () => {
        const hash = await hashPassword('whatever');
        expect(hash.startsWith('$argon2id$')).toBe(true);
    }, 20_000);

    test('a corrupt stored hash reads as a failed login, not a crash', async () => {
        expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false);
    });
});

describe('opaque tokens', () => {
    test('tokens are 256 bits and URL-safe', () => {
        const token = generateOpaqueToken();
        // base64url of 32 bytes, unpadded.
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    test('tokens do not repeat', () => {
        const seen = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()));
        expect(seen.size).toBe(500);
    });

    test('hashing is deterministic and comparison is by digest', () => {
        const token = generateOpaqueToken();
        expect(digestsEqual(hashToken(token), hashToken(token))).toBe(true);
        expect(digestsEqual(hashToken(token), hashToken(generateOpaqueToken()))).toBe(false);
    });

    test('IP hashing is salted, so the same address differs across deployments', () => {
        expect(hashIp('203.0.113.9', 'salt-a').equals(hashIp('203.0.113.9', 'salt-b'))).toBe(false);
        expect(hashIp('203.0.113.9', 'salt-a').equals(hashIp('203.0.113.9', 'salt-a'))).toBe(true);
    });
});

describe('access tokens', () => {
    const claims = { userId: 'u-1', publicId: 'A1B2C3D4', tier: 'free' as const, sessionId: 's-1' };

    test('round-trips the claims a request needs', async () => {
        const token = await signAccessToken(env, claims);
        const decoded = await verifyAccessToken(env, token);
        expect(decoded.sub).toBe('u-1');
        expect(decoded.pid).toBe('A1B2C3D4');
        // `sid` is what makes per-device revocation possible; losing it would
        // make logout silently ineffective rather than visibly broken.
        expect(decoded.sid).toBe('s-1');
    });

    test('a token signed with a different secret is rejected', async () => {
        const token = await signAccessToken(env, claims);
        const other = { ...env, JWT_SECRET: 'a-completely-different-secret-of-adequate-length' };
        resetJwtKey();
        await expect(verifyAccessToken(other, token)).rejects.toThrow(/Invalid access token/);
        resetJwtKey();
    });

    test('a token minted for a different audience is rejected', async () => {
        // The check that stops a token issued for a staging or sibling app
        // being replayed here.
        const staging = { ...env, JWT_AUDIENCE: 'some-other-app' };
        const token = await signAccessToken(staging, claims);
        await expect(verifyAccessToken(env, token)).rejects.toThrow(/Invalid access token/);
    });

    test('a token from a different issuer is rejected', async () => {
        const foreign = { ...env, JWT_ISSUER: 'not-horamind' };
        const token = await signAccessToken(foreign, claims);
        await expect(verifyAccessToken(env, token)).rejects.toThrow(/Invalid access token/);
    });

    test('garbage is rejected without throwing something unexpected', async () => {
        await expect(verifyAccessToken(env, 'not.a.jwt')).rejects.toThrow(/Invalid access token/);
    });
});

describe('route protection', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        resetEnv();
        resetJwtKey();
        app = await buildServer(loadEnv(TEST_ENV_VARS));
        await app.ready();
    });

    afterAll(async () => { await app?.close(); });

    test.each([
        ['GET',  '/v1/auth/me'],
        ['GET',  '/v1/sessions'],
        ['POST', '/v1/sessions/revoke'],
        ['POST', '/v1/auth/logout'],
        ['POST', '/v1/auth/delete-account'],
    ])('%s %s requires a bearer token', async (method, url) => {
        const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    test('a malformed authorization header is rejected', async () => {
        const res = await app.inject({
            method: 'GET', url: '/v1/auth/me',
            headers: { authorization: 'Basic dXNlcjpwYXNz' },
        });
        expect(res.statusCode).toBe(401);
    });

    test('registration validates its body before touching the database', async () => {
        // No Postgres in this suite, so a 400 proves validation ran first —
        // had it not, this would fail trying to connect.
        const res = await app.inject({
            method: 'POST', url: '/v1/auth/register',
            payload: { email: 'not-an-email', password: 'short' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    test('registration refuses without accepted terms', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/auth/register',
            payload: {
                email: 'someone@example.com',
                password: 'a-sufficiently-long-password',
                timezone: 'Asia/Kolkata',
            },
        });
        expect(res.statusCode).toBe(400);
    });

    test('an unknown timezone is rejected', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/auth/register',
            payload: {
                email: 'someone@example.com',
                password: 'a-sufficiently-long-password',
                timezone: 'Mars/Olympus_Mons',
                acceptedTerms: true,
            },
        });
        expect(res.statusCode).toBe(400);
    });

    test('the OAuth route only accepts providers we actually support', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/auth/oauth',
            payload: { provider: 'facebook', idToken: 'x'.repeat(20) },
        });
        expect(res.statusCode).toBe(400);
    });

    test('auth routes appear in the OpenAPI document', async () => {
        const spec = app.swagger();
        expect(spec.paths?.['/v1/auth/login']).toBeTruthy();
        expect(spec.paths?.['/v1/auth/oauth']).toBeTruthy();
        // In-app account deletion is an App Store requirement, so its absence
        // would be a submission blocker rather than a missing nicety.
        expect(spec.paths?.['/v1/auth/delete-account']).toBeTruthy();
    });
});
