import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as profiles from '../repos/profiles.js';
import * as users from '../repos/users.js';
import * as mem from '../repos/memories.js';
import { generateSections, inputsHash, type LifeSection } from '../services/life.js';
import { notFound } from '../lib/errors.js';

/**
 * The life reading: generated on request, refreshed when its inputs move.
 *
 * GET reports what is stored and whether it is stale; POST regenerates. Split
 * that way because this is the most expensive generation in the product — five
 * completions over the whole chart — and an endpoint that regenerated on read
 * would bill a user for opening a screen.
 *
 * Staleness is a hash comparison, not a timestamp. `inputsHash` digests the
 * chart, the memories and the interests that fed the prompt, so editing a
 * memory's wording marks the reading stale and reopening the screen does not.
 */

const Section = z.object({ key: z.string(), title: z.string(), body: z.string() });

const Analysis = z.object({
    status: z.enum(['none', 'ready']),
    sections: z.array(Section),
    /** True when the stored reading was built from material that has since changed. */
    stale: z.boolean(),
    generatedAt: z.string().nullable(),
    model: z.string().nullable(),
});

interface Row {
    sections: LifeSection[] | null;
    inputsHash: Buffer;
    model: string | null;
    updatedAt: Date;
}

export async function lifeRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    /** Everything both handlers need: the profile, and the material it reads. */
    async function gather(userId: string, profileId?: string) {
        const sql = getDb();
        const user = await users.findUserById(sql, userId);
        if (!user) throw notFound('User');

        const profile = profileId
            ? await profiles.findProfile(sql, userId, profileId)
            : await profiles.findPrimaryProfile(sql, userId);
        if (!profile) throw notFound('Birth profile');

        const [memories, interests] = await Promise.all([
            mem.listMemories(sql, userId),
            mem.listInterests(sql, userId),
        ]);

        return {
            sql, user, profile,
            memories: memories.map(mem.toMemory),
            interests: interests.map(mem.toInterest),
        };
    }

    typed.get('/life-analysis', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['ai'],
            description: 'The stored life reading, and whether its inputs have changed since.',
            security: [{ bearerAuth: [] }],
            querystring: z.object({ profileId: z.string().uuid().optional() }),
            response: { 200: Analysis },
        },
    }, async (req, reply) => {
        const { sql, profile, memories, interests } = await gather(req.user!.id, req.query.profileId);

        const [row] = await sql<Row[]>`
            SELECT sections, inputs_hash, model, updated_at
              FROM life_analyses
             WHERE birth_profile_id = ${profile.id} AND status = 'ready'`;

        if (!row?.sections) {
            return reply.status(200).send({
                status: 'none' as const, sections: [], stale: false,
                generatedAt: null, model: null,
            });
        }

        const current = inputsHash({ profile, memories, interests });
        return reply.status(200).send({
            status: 'ready' as const,
            sections: row.sections,
            stale: !current.equals(row.inputsHash),
            generatedAt: row.updatedAt.toISOString(),
            model: row.model,
        });
    });

    typed.post('/life-analysis', {
        onRequest: [app.authenticate],
        /*
         * Five completions per call, and the result is stored. One a minute is
         * already far more than anyone needs, and without a limit here a held
         * button is the most expensive thing a user can do to this account.
         */
        config: { rateLimit: { max: 1, timeWindow: '1 minute' } },
        schema: {
            tags: ['ai'],
            description: 'Generate or refresh the life reading. Expensive; rate limited.',
            security: [{ bearerAuth: [] }],
            body: z.object({ profileId: z.string().uuid().optional() }),
            response: { 200: Analysis },
        },
    }, async (req, reply) => {
        const { sql, user, profile, memories, interests } = await gather(req.user!.id, req.body.profileId);

        const sections = await generateSections({
            env: loadEnv(), sql, profile, tier: user.tier, memories, interests,
            onLlmCall: async call => {
                await sql`
                    INSERT INTO llm_calls
                        (user_id, purpose, provider, model, prompt_tokens,
                         completion_tokens, latency_ms, ok)
                    VALUES (${user.id}, 'reading', 'openrouter', ${call.model},
                            ${call.usage.promptTokens}, ${call.usage.completionTokens},
                            ${call.latencyMs}, true)`;
            },
        });

        const hash = inputsHash({ profile, memories, interests });

        // One row per profile, replaced rather than appended to. Nobody asked
        // for a history of readings, and the retention promise is easier to
        // honour against one row than a growing list.
        const [row] = await sql<Row[]>`
            INSERT INTO life_analyses
                (user_id, birth_profile_id, status, sections, inputs_hash, model)
            VALUES (${user.id}, ${profile.id}, 'ready',
                    ${sql.json(sections as never)}, ${hash}, ${'mixed'})
            ON CONFLICT (birth_profile_id) DO UPDATE
               SET sections = EXCLUDED.sections,
                   inputs_hash = EXCLUDED.inputs_hash,
                   status = 'ready',
                   error = NULL,
                   updated_at = now()
            RETURNING sections, inputs_hash, model, updated_at`;

        return reply.status(200).send({
            status: 'ready' as const,
            sections,
            stale: false,
            generatedAt: (row?.updatedAt ?? new Date()).toISOString(),
            model: row?.model ?? null,
        });
    });
}
