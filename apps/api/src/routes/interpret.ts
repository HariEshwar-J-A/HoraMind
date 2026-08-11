import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DateTime } from 'luxon';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as profiles from '../repos/profiles.js';
import * as mem from '../repos/memories.js';
import * as usage from '../repos/usage.js';
import * as users from '../repos/users.js';
import { buildFacts } from '../services/facts.js';
import { assemble } from '../services/prompt.js';
import { interpret } from '../services/interpret.js';
import { notFound } from '../lib/errors.js';

/**
 * One-shot interpretation.
 *
 * A question in, a grounded answer out. Stateless — the multi-turn chat with
 * compaction and 7-day retention is a separate endpoint (Epic 6); this one
 * exists because most questions are single questions, and paying to replay a
 * conversation that does not exist is waste.
 */

const InterpretRequestSchema = z.object({
    question: z.string().min(3).max(1000),
    profileId: z.string().uuid().optional(),
    /** The moment being asked about. Defaults to now, which is usually meant. */
    asOf: z.string().datetime({ offset: true }).optional(),
});

const InterpretResponseSchema = z.object({
    answer: z.string(),
    citations: z.array(z.object({
        source: z.string().nullable(),
        chapter: z.number().nullable(),
        verse: z.string().nullable(),
    })),
    dashaStack: z.array(z.object({
        levelName: z.string(),
        lord: z.string(),
        houseFromLordAbove: z.number().nullable(),
        classicalBranch: z.string().nullable(),
    })),
    quota: z.object({
        used: z.number(),
        limit: z.number(),
        remaining: z.number(),
    }),
    meta: z.object({
        model: z.string(),
        toolRounds: z.number(),
        latencyMs: z.number(),
    }),
});

export async function interpretRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const env = loadEnv();

    typed.post('/interpret', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['ai'],
            description:
                'Ask a question about a chart. The answer is grounded in computed facts and '
                + 'retrieved BPHS passages; the model presents them rather than deriving them.',
            security: [{ bearerAuth: [] }],
            body: InterpretRequestSchema,
            response: { 200: InterpretResponseSchema },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const { id: userId, tier } = req.user!;

        const user = await users.findUserById(sql, userId);
        if (!user) throw notFound('User');

        const profile = req.body.profileId
            ? await profiles.findProfile(sql, userId, req.body.profileId)
            : await profiles.findPrimaryProfile(sql, userId);
        if (!profile) throw notFound('Birth profile');

        // Consume before calling the model. The reverse order would let a burst
        // of concurrent requests each run a paid completion before any of them
        // had recorded usage.
        const quota = await usage.consume(sql, userId, tier, 'reading', user.timezone);

        const asOf = req.body.asOf
            ? DateTime.fromISO(req.body.asOf)
            : DateTime.now().setZone(user.timezone);

        const facts = buildFacts(profile, asOf);

        const [memories, interests] = await Promise.all([
            mem.listMemories(sql, userId),
            mem.listInterests(sql, userId),
        ]);

        const messages = await assemble({
            facts,
            memories: memories.map(mem.toMemory),
            interests: interests.map(mem.toInterest),
            history: [],
            question: req.body.question,
        });

        try {
            const result = await interpret({
                env, sql, userId, tier, messages,
                // Every model call is recorded, including the intermediate ones
                // that only decided to search. Metering just the final call
                // would quietly understate cost by however many tool rounds ran.
                onLlmCall: async call => {
                    await sql`
                        INSERT INTO llm_calls
                            (user_id, purpose, provider, model, prompt_tokens,
                             completion_tokens, latency_ms, ok)
                        VALUES (${userId}, 'reading', 'openrouter', ${call.model},
                                ${call.usage.promptTokens}, ${call.usage.completionTokens},
                                ${call.latencyMs}, ${call.ok})`;
                },
            });

            return reply.status(200).send({
                answer: result.answer,
                citations: result.citations,
                // Returned alongside the prose so a client can show the reasoning
                // the answer rests on rather than asking to be believed.
                dashaStack: facts.dashaStack.map(d => ({
                    levelName: String(d.levelName),
                    lord: String(d.lord),
                    houseFromLordAbove: (d.houseFromLordAbove as number | null) ?? null,
                    classicalBranch: (d.classicalBranch as string | null) ?? null,
                })),
                quota,
                meta: {
                    model: result.model,
                    toolRounds: result.toolRounds,
                    latencyMs: result.latencyMs,
                },
            });
        } catch (err) {
            // The user got nothing, so they should not be charged for it.
            await usage.refund(sql, userId, 'reading', user.timezone)
                .catch(e => req.log.warn({ err: e }, 'quota refund failed'));

            await sql`
                INSERT INTO llm_calls (user_id, purpose, provider, model, ok, error_code)
                VALUES (${userId}, 'reading', 'openrouter', 'unknown', false,
                        ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'})`
                .catch(() => { /* metering must never mask the original failure */ });

            throw err;
        }
    });

    typed.get('/interpret/quota', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['ai'],
            description: 'Remaining interpretations for today, in the user\'s own timezone.',
            security: [{ bearerAuth: [] }],
            response: {
                200: z.object({
                    used: z.number(), limit: z.number(), remaining: z.number(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const user = await users.findUserById(sql, req.user!.id);
        if (!user) throw notFound('User');
        return reply.status(200).send(
            await usage.peek(sql, req.user!.id, req.user!.tier, 'reading', user.timezone),
        );
    });
}
