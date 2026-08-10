import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
    CreateMemorySchema, UpdateMemorySchema, MemorySchema,
    InterestSchema, InterestPromptStateSchema, InterestPromptResponseSchema,
    TIER_LIMITS,
} from '@horamind/shared';

import { getDb } from '../db/client.js';
import * as mem from '../repos/memories.js';
import { notFound, badRequest } from '../lib/errors.js';

/**
 * Memories and interests.
 *
 * Both steer interpretation, and both are things the user says about
 * themselves rather than things inferred about them. That is the whole design:
 * a memory is written deliberately, and interests are asked for on a weekly
 * overlay instead of being derived from chat text — so nothing has to read
 * conversations to personalise a reading.
 */
export async function memoryRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/memories', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['memories'],
            security: [{ bearerAuth: [] }],
            response: {
                200: z.object({
                    memories: z.array(MemorySchema),
                    used: z.number().int(),
                    limit: z.number().int(),
                }),
            },
        },
    }, async (req, reply) => {
        const rows = await mem.listMemories(getDb(), req.user!.id);
        const limit = TIER_LIMITS[req.user!.tier].maxMemories;
        // Returned alongside the data so the client can show "12 of 30" rather
        // than discovering the cap by being rejected on submit.
        return reply.status(200).send({
            memories: rows.map(mem.toMemory), used: rows.length, limit,
        });
    });

    typed.post('/memories', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['memories'],
            description: 'Record an event: when, what happened, how it affected you, what you learnt.',
            security: [{ bearerAuth: [] }],
            body: CreateMemorySchema,
            response: { 201: MemorySchema },
        },
    }, async (req, reply) => {
        const row = await mem.createMemory(getDb(), req.user!.id, {
            occurredOn: req.body.occurredOn,
            whatHappened: req.body.whatHappened,
            howItAffected: req.body.howItAffected,
            whatILearnt: req.body.whatILearnt,
        });
        return reply.status(201).send(mem.toMemory(row));
    });

    typed.patch('/memories/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['memories'],
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            body: UpdateMemorySchema,
            response: { 200: MemorySchema },
        },
    }, async (req, reply) => {
        const row = await mem.updateMemory(getDb(), req.user!.id, req.params.id, req.body);
        if (!row) throw notFound('Memory');
        return reply.status(200).send(mem.toMemory(row));
    });

    typed.delete('/memories/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['memories'],
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            response: { 204: z.null() },
        },
    }, async (req, reply) => {
        const ok = await mem.deleteMemory(getDb(), req.user!.id, req.params.id);
        if (!ok) throw notFound('Memory');
        return reply.status(204).send(null);
    });

    // -----------------------------------------------------------------------
    // Interests and the weekly prompt
    // -----------------------------------------------------------------------

    typed.get('/interests', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['interests'],
            security: [{ bearerAuth: [] }],
            response: {
                200: z.object({
                    interests: z.array(InterestSchema),
                    limit: z.number().int(),
                }),
            },
        },
    }, async (req, reply) => {
        const rows = await mem.listInterests(getDb(), req.user!.id);
        return reply.status(200).send({
            interests: rows.map(mem.toInterest),
            limit: TIER_LIMITS[req.user!.tier].maxInterests,
        });
    });

    typed.get('/interests/prompt', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['interests'],
            description:
                'Whether the weekly interest overlay is due. Anchored to the user\'s own '
                + 'onboarding date, so load spreads across the week rather than piling onto Monday.',
            security: [{ bearerAuth: [] }],
            response: { 200: InterestPromptStateSchema },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const state = await mem.getPromptState(sql, req.user!.id);
        if (!state) throw notFound('User');

        const current = await mem.listInterests(sql, req.user!.id);
        const limit = TIER_LIMITS[req.user!.tier].maxInterests;

        return reply.status(200).send({
            due: !state.optedOut && state.dueAt !== null && state.dueAt <= new Date(),
            dueAt: state.dueAt ? state.dueAt.toISOString() : null,
            optedOut: state.optedOut,
            current: current.map(mem.toInterest),
            remainingSlots: Math.max(0, limit - current.length),
        });
    });

    typed.post('/interests/prompt', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['interests'],
            description:
                'Respond to the weekly overlay: answer it, skip for a week, or never ask again. '
                + 'One endpoint for all three so the prompt cannot be left neither answered nor '
                + 'rescheduled, which would make it reappear on every launch.',
            security: [{ bearerAuth: [] }],
            body: InterestPromptResponseSchema,
            response: {
                200: z.object({
                    interests: z.array(InterestSchema),
                    nextDueAt: z.string().nullable(),
                    optedOut: z.boolean(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const userId = req.user!.id;
        const limit = TIER_LIMITS[req.user!.tier].maxInterests;

        if (req.body.action === 'never') {
            await mem.optOutOfPrompt(sql, userId);
            const current = await mem.listInterests(sql, userId);
            return reply.status(200).send({
                interests: current.map(mem.toInterest), nextDueAt: null, optedOut: true,
            });
        }

        if (req.body.action === 'skip') {
            const next = await mem.deferPrompt(sql, userId, false);
            const current = await mem.listInterests(sql, userId);
            return reply.status(200).send({
                interests: current.map(mem.toInterest),
                nextDueAt: next.toISOString(),
                optedOut: false,
            });
        }

        if (!req.body.interests) {
            throw badRequest('Provide "interests" when the action is "answer"');
        }

        const saved = await mem.replaceInterests(
            sql, userId,
            req.body.interests.map(i => ({ label: i.label, weight: i.weight })),
            limit,
        );
        const next = await mem.deferPrompt(sql, userId, true);

        return reply.status(200).send({
            interests: saved.map(mem.toInterest),
            nextDueAt: next.toISOString(),
            optedOut: false,
        });
    });
}
