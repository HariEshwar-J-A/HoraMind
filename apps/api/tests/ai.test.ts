import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';

import { loadEnv, resetEnv, type Env } from '../src/config/env.js';
import { renderMemories, renderInterests, renderFacts, assemble, resetInstructionCache } from '../src/services/prompt.js';
import { periodStart } from '../src/repos/usage.js';
import * as openrouter from '../src/lib/openrouter.js';
import type { Memory, Interest } from '@horamind/shared';

/**
 * AI layer tests.
 *
 * No live model call. What is verified here is everything around it: the
 * request we build, the errors we map, the loop we run, and the accounting we
 * keep. Those are the parts that are wrong-able deterministically — whether a
 * model gives a *good* reading is not something a unit test can assert.
 *
 * `fetch` is stubbed, so the tool loop and error handling are exercised for
 * real without an API key.
 */

const TEST_ENV_VARS = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/horamind_test',
    JWT_SECRET: 'test-only-secret-at-least-thirty-two-chars-long',
    OPENROUTER_API_KEY: 'sk-or-test-key-not-real',
    LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv;

let env: Env;

beforeAll(() => {
    resetEnv();
    resetInstructionCache();
    env = loadEnv(TEST_ENV_VARS);
});

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(status: number, body: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })));
}

describe('prompt assembly', () => {
    const memories: Memory[] = [{
        id: 'm1',
        occurredOn: '2021-03-01',
        whatHappened: 'Left a stable job',
        howItAffected: 'Anxious for months',
        whatILearnt: 'I need a runway before I leap',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    }];

    const interests: Interest[] = [
        { id: 'i1', label: 'career', weight: 0.9, source: 'user',
          refreshedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'i2', label: 'health', weight: 0.4, source: 'user',
          refreshedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    test('memories keep all four fields, learning labelled', () => {
        const text = renderMemories(memories);
        expect(text).toContain('2021-03-01');
        expect(text).toContain('Left a stable job');
        // The field that should steer advice must be distinguishable from
        // the narrative around it.
        expect(text).toContain('What they learnt: I need a runway before I leap');
    });

    test('memory rendering forbids invention', () => {
        expect(renderMemories(memories)).toMatch(/[Nn]ever invent/);
    });

    test('a memory without a date says so rather than guessing one', () => {
        const undated = [{ ...memories[0]!, occurredOn: null }];
        expect(renderMemories(undated)).toContain('date not given');
    });

    test('empty collections render as nothing, not as empty headings', () => {
        expect(renderMemories([])).toBe('');
        expect(renderInterests([])).toBe('');
    });

    test('interests are ordered by weight', () => {
        const text = renderInterests(interests);
        expect(text.indexOf('career')).toBeLessThan(text.indexOf('health'));
    });

    test('facts are rendered as JSON, not prose', () => {
        // Prose invites paraphrase; a number does not. A model handed
        // "about 24 degrees of Gemini" will drift in a way one handed
        // 84.511003 will not.
        const text = renderFacts({ moon: { longitude: 84.511003 } });
        expect(text).toContain('84.511003');
        expect(text).toMatch(/```json/);
        expect(text).toMatch(/[Dd]o not adjust/);
    });

    test('messages are ordered instructions, facts, profile, then question', async () => {
        const messages = await assemble({
            facts: { natal: {} }, memories, interests, history: [],
            question: 'What about my career this year?',
        });

        expect(messages[0]!.role).toBe('system');
        expect(messages[0]!.content).toContain('HoraMind');

        const last = messages[messages.length - 1]!;
        expect(last.role).toBe('user');
        expect(last.content).toBe('What about my career this year?');

        // The rules file carries the hinge that decides which branch of a
        // classical verse applies; losing it would silently halve accuracy.
        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        expect(system).toContain('houseFromLordAbove');
    });

    test('a compacted summary is included when present', async () => {
        const messages = await assemble({
            facts: {}, memories: [], interests: [],
            priorSummary: 'The user asked about marriage timing.',
            history: [], question: 'And work?',
        });
        expect(messages.some(m => m.content?.includes('asked about marriage timing'))).toBe(true);
    });
});

describe('quota period boundaries', () => {
    test('the day boundary follows the user, not the server', () => {
        // 20:00 UTC is already the next day in Kolkata (+05:30). A quota that
        // resets at server midnight would reset mid-afternoon for this user.
        const at = new Date('2026-08-10T20:00:00Z');
        expect(periodStart('Asia/Kolkata', at)).toBe('2026-08-11');
        expect(periodStart('UTC', at)).toBe('2026-08-10');
        expect(periodStart('America/Los_Angeles', at)).toBe('2026-08-10');
    });

    test('an unknown timezone falls back to UTC rather than throwing', () => {
        // A bad zone must not make the quota check crash — it would fail open
        // or closed unpredictably depending on where it was caught.
        expect(periodStart('Mars/Olympus', new Date('2026-08-10T20:00:00Z'))).toBe('2026-08-10');
    });
});

describe('openrouter error mapping', () => {
    test('a missing API key is a configuration failure, not a bad request', async () => {
        resetEnv();
        const noKey = loadEnv({ ...TEST_ENV_VARS, OPENROUTER_API_KEY: undefined });
        await expect(
            openrouter.complete(noKey, { model: 'x', messages: [] }),
        ).rejects.toMatchObject({ statusCode: 503 });
        resetEnv();
        env = loadEnv(TEST_ENV_VARS);
    });

    test('rate limiting is marked retryable so a caller can fall back', async () => {
        // Free-tier models are shared and throttled. This has to be
        // distinguishable from a generic failure or the only option is to tell
        // the user something went wrong.
        stubFetch(429, { error: { message: 'rate limited' } });
        await expect(openrouter.complete(env, { model: 'x', messages: [] }))
            .rejects.toMatchObject({ details: { retryable: true } });
    });

    test('running out of credit is reported as not retryable', async () => {
        stubFetch(402, { error: { message: 'insufficient credits' } });
        await expect(openrouter.complete(env, { model: 'x', messages: [] }))
            .rejects.toMatchObject({ details: { retryable: false } });
    });

    test('usage is read from the response, since the paywall bills from it', async () => {
        stubFetch(200, {
            id: 'gen-123',
            model: 'test/model',
            choices: [{ message: { content: 'An answer.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
        });

        const result = await openrouter.complete(env, { model: 'x', messages: [] });
        expect(result.usage.promptTokens).toBe(1200);
        expect(result.usage.completionTokens).toBe(300);
        // Cost is keyed by this id, so losing it means losing reconciliation.
        expect(result.generationId).toBe('gen-123');
    });

    test('a response with no usage block reads as zero rather than NaN', async () => {
        stubFetch(200, { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
        const result = await openrouter.complete(env, { model: 'x', messages: [] });
        expect(result.usage.totalTokens).toBe(0);
    });

    test('attribution headers identify this app to OpenRouter', async () => {
        const spy = vi.fn(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: 'x' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', spy);

        await openrouter.complete(env, { model: 'x', messages: [] });

        const init = spy.mock.calls[0]![1] as RequestInit;
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer sk-or-test-key-not-real');
        expect(headers['X-Title']).toBe('HoraMind');
    });

    test('cost lookup returns null rather than throwing when unavailable', async () => {
        // Billing reconciliation must never be able to fail a user's reading.
        stubFetch(500, {});
        expect(await openrouter.fetchCost(env, 'gen-123')).toBeNull();
    });
});
