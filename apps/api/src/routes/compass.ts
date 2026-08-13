import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CompassQuerySchema } from '@horamind/shared';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as profiles from '../repos/profiles.js';
import * as usage from '../repos/usage.js';
import * as users from '../repos/users.js';
import * as compass from '../services/compass.js';
import { notFound } from '../lib/errors.js';

/**
 * The daily compass.
 *
 * Cached by (profile, local date) and generated lazily on first open. Two
 * requests on the same day return the same answer — a user who reloads and
 * reads different advice has learnt that the app is guessing.
 */
export async function compassRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const env = loadEnv();

    typed.get('/compass', {
        onRequest: [app.authenticate],
        // Generation is cached per day, but a cache miss is a paid completion.
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
            tags: ['compass'],
            description:
                'One day\'s guidance. Mostly deterministic — Panchanga, the live dasha and '
                + 'transit houses from the natal Moon are computed; the model only phrases them. '
                + 'The basis is returned so the advice can be inspected rather than believed.',
            security: [{ bearerAuth: [] }],
            querystring: CompassQuerySchema,
            response: {
                200: z.object({
                    date: z.string(),
                    headline: z.string(),
                    dos: z.array(z.string()),
                    donts: z.array(z.string()),
                    basis: z.record(z.unknown()),
                    fromCache: z.boolean(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const { id: userId, tier } = req.user!;

        const user = await users.findUserById(sql, userId);
        if (!user) throw notFound('User');

        const profile = req.query.birthProfileId
            ? await profiles.findProfile(sql, userId, req.query.birthProfileId)
            : await profiles.findPrimaryProfile(sql, userId);
        if (!profile) throw notFound('Birth profile');

        const date = req.query.date ?? compass.localDate(user.timezone);

        // A cache hit costs nothing and must not consume quota — otherwise
        // opening the app twice in a day is charged as two generations.
        const cached = await compass.getCached(sql, profile.id, date);
        if (cached) {
            return reply.status(200).send({ ...cached, fromCache: true });
        }

        const quotaState = await usage.consume(sql, userId, tier, 'compass', user.timezone);

        try {
            const { payload, fromCache } = await compass.generate(
                env, sql, profile, tier, user.timezone, date,
            );

            await sql`
                INSERT INTO llm_calls (user_id, purpose, provider, model, ok)
                VALUES (${userId}, 'compass', 'openrouter', ${env.OPENROUTER_MODEL_FREE}, true)`
                .catch(() => { /* metering must not fail the response */ });

            return reply.status(200).send({ ...payload, fromCache });
        } catch (err) {
            await usage.refund(sql, userId, 'compass', user.timezone)
                .catch(e => req.log.warn({ err: e }, 'quota refund failed'));

            // The deterministic half is still correct and still useful, so a
            // model outage degrades the compass rather than removing it.
            req.log.warn({ err, quotaState }, 'compass generation failed; serving basis only');
            return reply.status(200).send({
                date,
                headline: 'Guidance is unavailable right now — the computed factors are below.',
                dos: [],
                donts: [],
                basis: compass.computeBasis(profile, date, user.timezone),
                fromCache: false,
            });
        }
    });
}
