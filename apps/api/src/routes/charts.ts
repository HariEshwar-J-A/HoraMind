import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import * as profiles from '../repos/profiles.js';
import * as charts from '../services/charts.js';
import { notFound } from '../lib/errors.js';

/**
 * Chart endpoints.
 *
 * Everything here is deterministic: the same profile and the same settings
 * produce the same numbers forever. No language model is involved, and none
 * should be — these are the facts an interpretation is built on, and if they
 * were generated rather than computed the whole product would be a guess with
 * good typography.
 *
 * The 16 divisional charts were audited against Santhanam's BPHS with chapter
 * and verse in node-jhora; this layer only selects and formats them.
 */

/** Vargas BPHS names, so a client cannot request a division that has no rule. */
const VALID_DIVISIONS = [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60];

async function profileFor(userId: string, id?: string) {
    const sql = getDb();
    const row = id
        ? await profiles.findProfile(sql, userId, id)
        : await profiles.findPrimaryProfile(sql, userId);
    if (!row) throw notFound(id ? 'Profile' : 'Primary profile');
    return row;
}

const ProfileQuery = z.object({ profileId: z.string().uuid().optional() });

export async function chartRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/charts/natal', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description: 'Rasi (D1): planets, houses and the ascendant.',
            security: [{ bearerAuth: [] }],
            querystring: ProfileQuery,
        },
    }, async (req, reply) => {
        const profile = await profileFor(req.user!.id, req.query.profileId);
        return reply.status(200).send(charts.natalChart(charts.contextFor(profile)));
    });

    typed.get('/charts/vargas', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description: 'Divisional charts. Defaults to the shodasavarga set used in practice.',
            security: [{ bearerAuth: [] }],
            querystring: ProfileQuery.extend({
                divisions: z.string().optional()
                    .describe('Comma-separated varga numbers, e.g. "9,10,12"'),
            }),
        },
    }, async (req, reply) => {
        const profile = await profileFor(req.user!.id, req.query.profileId);

        const requested = req.query.divisions
            ? req.query.divisions.split(',').map(s => Number(s.trim()))
            : [1, 9, 10, 12];

        // Silently ignoring an unknown division would return a chart the client
        // did not ask for; rejecting says which one was wrong.
        const invalid = requested.filter(d => !VALID_DIVISIONS.includes(d));
        if (invalid.length) {
            return reply.status(400).send({
                error: {
                    code: 'BAD_REQUEST',
                    message: `Unsupported division(s): ${invalid.join(', ')}`,
                    details: { supported: VALID_DIVISIONS },
                    requestId: req.id,
                },
            });
        }

        return reply.status(200).send({
            vargas: charts.vargaCharts(charts.contextFor(profile), requested),
        });
    });

    typed.get('/charts/dasha', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description:
                'Vimshottari dasha tree. Depth 3 reaches Pratyantardasha, which is the level '
                + 'a reading needs — a Mahadasha alone can span twenty years.',
            security: [{ bearerAuth: [] }],
            querystring: ProfileQuery.extend({
                depth: z.coerce.number().int().min(1).max(5).default(3),
            }),
        },
    }, async (req, reply) => {
        const profile = await profileFor(req.user!.id, req.query.profileId);
        return reply.status(200).send({
            depth: req.query.depth,
            periods: charts.dashaTree(charts.contextFor(profile), req.query.depth),
        });
    });

    typed.get('/charts/ashtakavarga', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description: 'Sarvashtakavarga bindus by sign. Below ~25 a transit tends to disappoint.',
            security: [{ bearerAuth: [] }],
            querystring: ProfileQuery,
        },
    }, async (req, reply) => {
        const profile = await profileFor(req.user!.id, req.query.profileId);
        return reply.status(200).send(charts.ashtakavarga(charts.contextFor(profile)));
    });

    typed.get('/charts/panchanga', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description: 'Tithi, Nakshatra, Yoga, Karana and Vara at birth.',
            security: [{ bearerAuth: [] }],
            querystring: ProfileQuery,
        },
    }, async (req, reply) => {
        const profile = await profileFor(req.user!.id, req.query.profileId);
        return reply.status(200).send(charts.panchanga(charts.contextFor(profile)));
    });
}
