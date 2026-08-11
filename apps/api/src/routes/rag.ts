import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as rag from '../services/rag.js';

/**
 * Retrieval endpoint.
 *
 * Deliberately plain HTTP rather than MCP. OpenRouter speaks OpenAI-style
 * function calling, not MCP, so an MCP server between our own AI layer and our
 * own corpus would be a protocol translation with nothing on either side that
 * wanted it. If an external MCP client ever needs this corpus, the same handler
 * wraps in an MCP server later — nothing here forecloses that.
 *
 * Every call is logged as a **hash of the query plus the verses returned**,
 * never the text. That keeps retrieval quality debuggable and citations
 * auditable without retaining what the user asked.
 */

const RagQuerySchema = z.object({
    query: z.string().min(3).max(500),
    topK: z.number().int().min(1).max(10).default(4),
});

const RagHitSchema = z.object({
    id: z.string(),
    document: z.string(),
    distance: z.number(),
    adjusted: z.number(),
    source: z.string().nullable(),
    chapter: z.number().nullable(),
    verse: z.string().nullable(),
    matchedEntities: z.array(z.string()),
});

export async function ragRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const env = loadEnv();

    typed.post('/rag/query', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['rag'],
            description:
                'Search the BPHS corpus. Results are re-ranked for substance and boosted by '
                + 'entity match, so a question about a specific planet-house pair surfaces the '
                + 'verse that states the rule rather than the chapter heading above it.',
            security: [{ bearerAuth: [] }],
            body: RagQuerySchema,
            response: {
                200: z.object({
                    hits: z.array(RagHitSchema),
                    entities: z.array(z.string()),
                    latencyMs: z.number(),
                }),
            },
        },
    }, async (req, reply) => {
        const result = await rag.query(env, req.body.query, req.body.topK);

        // Fire-and-forget: a logging failure must not fail the user's request,
        // but it must still be visible, so the rejection is caught and logged
        // rather than swallowed or left unhandled.
        void logRetrieval(req.user!.id, result).catch(err =>
            req.log.warn({ err }, 'failed to record rag_call'));

        return reply.status(200).send({
            hits: result.hits,
            entities: result.entities,
            latencyMs: result.latencyMs,
        });
    });
}

async function logRetrieval(userId: string, result: rag.RagResult): Promise<void> {
    const sql = getDb();
    const env = loadEnv();

    await sql`
        INSERT INTO rag_calls (user_id, query_hash, collection, top_k, results, latency_ms)
        VALUES (
            ${userId},
            ${result.queryHash},
            ${env.CHROMA_COLLECTION},
            ${result.hits.length},
            ${sql.json(result.hits.map(h => ({
                id: h.id,
                score: Number(h.adjusted.toFixed(6)),
                chapter: h.chapter,
                verse: h.verse,
            })))},
            ${result.latencyMs}
        )`;
}
