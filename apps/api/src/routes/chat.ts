import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DateTime } from 'luxon';

import { CreateChatSchema, SendMessageSchema, ChatSchema, ChatMessageSchema, TIER_LIMITS } from '@horamind/shared';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as chats from '../repos/chats.js';
import * as profiles from '../repos/profiles.js';
import * as mem from '../repos/memories.js';
import * as usage from '../repos/usage.js';
import * as users from '../repos/users.js';
import { buildFacts } from '../services/facts.js';
import { assemble } from '../services/prompt.js';
import { interpret } from '../services/interpret.js';
import { compactIfNeeded, estimateTokens } from '../services/compaction.js';
import { notFound, badRequest } from '../lib/errors.js';
import type { ChatMessage } from '../lib/openrouter.js';

/**
 * Multi-turn chat.
 *
 * Every chat has a finite life — 7 days on the free tier — after which it and
 * every message in it are permanently deleted by `run_retention()`. `expiresAt`
 * is on every response so the client can warn before it happens; silently
 * deleting something a user valued is how an app earns one-star reviews.
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const env = loadEnv();

    typed.get('/chats', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            security: [{ bearerAuth: [] }],
            response: {
                200: z.object({
                    chats: z.array(ChatSchema),
                    retentionDays: z.number(),
                }),
            },
        },
    }, async (req, reply) => {
        const rows = await chats.listChats(getDb(), req.user!.id);
        return reply.status(200).send({
            chats: rows.map(c => ({
                id: c.id,
                title: c.title,
                birthProfileId: c.birthProfileId,
                createdAt: c.createdAt.toISOString(),
                lastMessageAt: c.lastMessageAt.toISOString(),
                expiresAt: c.expiresAt.toISOString(),
                messageCount: c.messageCount,
            })),
            // Stated explicitly so the client can explain the countdown rather
            // than hard-coding a number that only matches the free tier.
            retentionDays: TIER_LIMITS[req.user!.tier].chatRetentionDays,
        });
    });

    typed.post('/chats', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            security: [{ bearerAuth: [] }],
            body: CreateChatSchema,
            response: { 201: ChatSchema },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const profile = req.body.birthProfileId
            ? await profiles.findProfile(sql, req.user!.id, req.body.birthProfileId)
            : await profiles.findPrimaryProfile(sql, req.user!.id);
        if (!profile) throw notFound('Birth profile');

        const chat = await chats.createChat(
            sql, req.user!.id, req.user!.tier, profile.id, req.body.title ?? null,
        );

        return reply.status(201).send({
            id: chat.id,
            title: chat.title,
            birthProfileId: chat.birthProfileId,
            createdAt: chat.createdAt.toISOString(),
            lastMessageAt: chat.lastMessageAt.toISOString(),
            expiresAt: chat.expiresAt.toISOString(),
            messageCount: 0,
        });
    });

    typed.get('/chats/:id/messages', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            description:
                'Messages still held in full. Older turns may have been compacted into a '
                + 'summary and deleted; `compactedBefore` says where that boundary sits.',
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            response: {
                200: z.object({
                    messages: z.array(ChatMessageSchema),
                    compactedBefore: z.string().nullable(),
                    expiresAt: z.string(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const chat = await chats.findChat(sql, req.user!.id, req.params.id);
        if (!chat) throw notFound('Chat');

        const [messages, summary] = await Promise.all([
            chats.listMessages(sql, chat.id),
            chats.latestSummary(sql, chat.id),
        ]);

        return reply.status(200).send({
            messages: messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    createdAt: m.createdAt.toISOString(),
                    grounding: (m.contextRef as never) ?? null,
                })),
            compactedBefore: summary ? summary.throughMessageAt.toISOString() : null,
            expiresAt: chat.expiresAt.toISOString(),
        });
    });

    typed.post('/chats/:id/messages', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            description: 'Send a turn and receive the grounded reply.',
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            body: SendMessageSchema,
            response: {
                200: z.object({
                    message: ChatMessageSchema,
                    quota: z.object({
                        used: z.number(), limit: z.number(), remaining: z.number(),
                    }),
                    compacted: z.boolean(),
                    expiresAt: z.string(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const { id: userId, tier } = req.user!;

        const user = await users.findUserById(sql, userId);
        if (!user) throw notFound('User');

        const chat = await chats.findChat(sql, userId, req.params.id);
        if (!chat) throw notFound('Chat');

        const profile = chat.birthProfileId
            ? await profiles.findProfile(sql, userId, chat.birthProfileId)
            : await profiles.findPrimaryProfile(sql, userId);
        if (!profile) throw badRequest('This chat has no birth profile attached');

        const quota = await usage.consume(sql, userId, tier, 'chat_message', user.timezone);

        try {
            // Compact before assembling, not after. Doing it afterwards would
            // mean the turn that overflowed is the one that fails.
            const compaction = await compactIfNeeded(env, sql, chat.id, tier);

            const [history, summary, memories, interests] = await Promise.all([
                chats.listMessages(sql, chat.id),
                chats.latestSummary(sql, chat.id),
                mem.listMemories(sql, userId),
                mem.listInterests(sql, userId),
            ]);

            const asOf = req.body.asOf
                ? DateTime.fromISO(req.body.asOf)
                : DateTime.now().setZone(user.timezone);

            const facts = buildFacts(profile, asOf);

            const messages = await assemble({
                facts,
                memories: memories.map(mem.toMemory),
                interests: interests.map(mem.toInterest),
                priorSummary: summary?.summary ?? null,
                history: history
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({ role: m.role, content: m.content }) as ChatMessage),
                question: req.body.content,
            });

            // The user turn is deliberately NOT written yet.
            //
            // Persisting it before the model call leaves an orphaned question
            // behind whenever that call fails. The next attempt then loads it
            // as history *and* appends the same text as the new question, so
            // the model sees it twice and answers as though it had been asked
            // twice. Both turns are written together once there is a reply.
            const result = await interpret({
                env, sql, userId, tier, messages,
                onLlmCall: async call => {
                    await sql`
                        INSERT INTO llm_calls
                            (user_id, chat_id, purpose, provider, model, prompt_tokens,
                             completion_tokens, latency_ms, ok)
                        VALUES (${userId}, ${chat.id}, 'chat', 'openrouter', ${call.model},
                                ${call.usage.promptTokens}, ${call.usage.completionTokens},
                                ${call.latencyMs}, ${call.ok})`;
                },
            });

            await chats.addMessage(
                sql, chat.id, 'user', req.body.content, estimateTokens(req.body.content),
            );

            // The grounding travels with the message so a past reply can still
            // show its sources after the chart or the dasha has moved on.
            const stored = await chats.addMessage(
                sql, chat.id, 'assistant', result.answer,
                result.usage.completionTokens,
                {
                    dashaStack: facts.dashaStack.map(d => `${d.levelName}: ${d.lord}`),
                    citations: result.citations,
                },
            );

            return reply.status(200).send({
                message: {
                    id: stored.id,
                    role: 'assistant' as const,
                    content: stored.content,
                    createdAt: stored.createdAt.toISOString(),
                    grounding: {
                        dashaStack: facts.dashaStack.map(d => `${d.levelName}: ${d.lord}`),
                        citations: result.citations,
                    },
                },
                quota,
                compacted: compaction.compacted,
                expiresAt: chat.expiresAt.toISOString(),
            });
        } catch (err) {
            await usage.refund(sql, userId, 'chat_message', user.timezone)
                .catch(e => req.log.warn({ err: e }, 'quota refund failed'));
            throw err;
        }
    });

    typed.delete('/chats/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            description: 'Delete a chat and every message in it, immediately and permanently.',
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            response: { 204: z.null() },
        },
    }, async (req, reply) => {
        const ok = await chats.deleteChat(getDb(), req.user!.id, req.params.id);
        if (!ok) throw notFound('Chat');
        return reply.status(204).send(null);
    });

    typed.get('/chats/expiring', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['chat'],
            description:
                'Chats due to be deleted within the window. Exists so the client can warn '
                + 'before a conversation disappears rather than after.',
            security: [{ bearerAuth: [] }],
            querystring: z.object({
                withinHours: z.coerce.number().int().min(1).max(168).default(24),
            }),
            response: {
                200: z.object({
                    chats: z.array(z.object({
                        id: z.string(),
                        title: z.string().nullable(),
                        expiresAt: z.string(),
                    })),
                }),
            },
        },
    }, async (req, reply) => {
        const rows = await chats.expiringSoon(getDb(), req.user!.id, req.query.withinHours);
        return reply.status(200).send({
            chats: rows.map(c => ({
                id: c.id, title: c.title, expiresAt: c.expiresAt.toISOString(),
            })),
        });
    });
}
