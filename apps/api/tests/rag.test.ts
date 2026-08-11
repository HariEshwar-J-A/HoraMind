import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { loadEnv, resetEnv } from '../src/config/env.js';
import { resetJwtKey } from '../src/lib/jwt.js';
import { extractEntities } from '../src/lib/entities.js';
import { poolAndNormalise } from '../src/lib/embeddings.js';

/**
 * Retrieval tests.
 *
 * Entity extraction and pooling are covered thoroughly because both are
 * wrong-able in ways that produce plausible output. A substring match returns
 * results — just the wrong ones. Pooling that differs from what ingestion used
 * puts queries in a slightly different vector space, and the symptom is
 * "retrieval feels a bit off" rather than an error.
 *
 * The Chroma round trip needs a running corpus and belongs in integration.
 */

const TEST_ENV = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

describe('entity extraction', () => {
    test('finds planets by English and Sanskrit name', () => {
        expect(extractEntities('effects of Shani')).toContain('planet_saturn');
        expect(extractEntities('effects of Saturn')).toContain('planet_saturn');
        expect(extractEntities('what does Guru give')).toContain('planet_jupiter');
    });

    test('matches whole words only', () => {
        // The original false-positive cause. Substring matching tagged
        // "galileo" as Leo and "keturatna" as Ketu, which pulled unrelated
        // passages to the top with a confident-looking score.
        expect(extractEntities('galileo studied the sky')).not.toContain('sign_leo');
        expect(extractEntities('keturatna is a gemstone')).not.toContain('planet_ketu');
        expect(extractEntities('Ketu in the 12th house')).toContain('planet_ketu');
    });

    test('reads house numbers only when a house is actually meant', () => {
        expect(extractEntities('Rahu in the 9th house')).toContain('house_9');
        expect(extractEntities('ninth house matters')).toContain('house_9');
        // "the 9th lord" is a lordship, not a house placement.
        expect(extractEntities('the 9th lord is strong')).not.toContain('house_9');
        // A bare year must never become a house.
        expect(extractEntities('born in 1998')).not.toContain('house_12');
    });

    test('recognises divisional charts by number and by name', () => {
        expect(extractEntities('what does D9 show')).toContain('division_9');
        expect(extractEntities('navamsa analysis')).toContain('division_9');
        expect(extractEntities('the D-10 chart')).toContain('division_10');
        // D5 is not a division BPHS defines, so it must not be tagged.
        expect(extractEntities('what about D5')).not.toContain('division_5');
    });

    test('extracts several entities from one question', () => {
        const found = extractEntities('What are the effects of Rahu in the 9th house in navamsa?');
        expect(found).toContain('planet_rahu');
        expect(found).toContain('house_9');
        expect(found).toContain('division_9');
    });

    test('returns nothing rather than guessing when no entity is named', () => {
        // This is why boosting beats filtering: a hard `where` on an empty
        // entity set would return no results at all.
        expect(extractEntities('what happens on a Sunday?')).toEqual([]);
    });
});

describe('embedding pooling', () => {
    test('mean-pools across tokens and L2-normalises', () => {
        // Two tokens, three dims: means are 2.5, 3.5, 4.5.
        const data = new Float32Array([1, 2, 3, 4, 5, 6]);
        const out = poolAndNormalise(data, 2, 3);

        const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
        expect(norm).toBeCloseTo(1, 6);

        // Direction must be preserved; only the magnitude changes.
        expect(out[1]! / out[0]!).toBeCloseTo(3.5 / 2.5, 5);
    });

    test('a zero vector does not become NaN', () => {
        // Normalising by a zero norm would poison every distance downstream
        // with NaN, and NaN sorts unpredictably rather than failing loudly.
        const out = poolAndNormalise(new Float32Array([0, 0, 0, 0]), 2, 2);
        expect(out.every(Number.isFinite)).toBe(true);
    });

    test('output dimensionality matches the model', () => {
        const dim = 384;
        const out = poolAndNormalise(new Float32Array(dim * 3).fill(0.5), 3, dim);
        expect(out).toHaveLength(dim);
    });
});

describe('rag route', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        resetEnv();
        resetJwtKey();
        app = await buildServer(loadEnv(TEST_ENV));
        await app.ready();
    });

    afterAll(async () => { await app?.close(); });

    test('requires authentication', async () => {
        const res = await app.inject({
            method: 'POST', url: '/v1/rag/query', payload: { query: 'Rahu in the 9th' },
        });
        expect(res.statusCode).toBe(401);
    });

    test('is documented in OpenAPI', async () => {
        expect(app.swagger().paths?.['/v1/rag/query']).toBeTruthy();
    });

    test('the corpus is not exposed over MCP', async () => {
        // OpenRouter speaks OpenAI-style function calling, not MCP. An MCP
        // server between our own AI layer and our own corpus would be a
        // translation nothing on either side asked for.
        const paths = Object.keys(app.swagger().paths ?? {});
        expect(paths.some(p => p.includes('mcp'))).toBe(false);
    });
});
