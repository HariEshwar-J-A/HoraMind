import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
    CreateBirthProfileSchema, UpdateBirthProfileSchema, BirthProfileSchema,
    PlaceSearchSchema, PlaceResultSchema, ChartSettingsSchema,
} from '@horamind/shared';

import { getDb } from '../db/client.js';
import * as profiles from '../repos/profiles.js';
import { beginPromptCycle } from '../repos/memories.js';
import { searchPlaces, timezoneForCoordinates } from '../lib/places.js';
import { notFound, badRequest } from '../lib/errors.js';

/**
 * Birth profiles and place lookup.
 *
 * A profile is the unit everything else hangs off: charts, the daily compass,
 * and the context handed to the AI layer. It stores its own calculation
 * settings so a chart cannot move underneath a user.
 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // -----------------------------------------------------------------------
    // Place lookup — no auth. It reveals nothing about any user, and requiring
    // a token would force the onboarding form to authenticate before it can
    // even offer a city list.
    // -----------------------------------------------------------------------

    typed.get('/places/search', {
        schema: {
            tags: ['places'],
            description:
                'Search birth places. Returns coordinates and, critically, the IANA timezone: '
                + 'a chart computed in the wrong zone is wrong by the whole offset.',
            querystring: PlaceSearchSchema,
            response: { 200: z.object({ results: z.array(PlaceResultSchema) }) },
        },
    }, async (req, reply) =>
        reply.status(200).send({ results: searchPlaces(req.query.query, req.query.limit) }));

    typed.get('/places/timezone', {
        schema: {
            tags: ['places'],
            description:
                'Best-guess IANA timezone for a coordinate pair. Approximate near borders, '
                + 'so confirm with the user rather than applying it silently.',
            querystring: z.object({
                latitude: z.coerce.number().min(-90).max(90),
                longitude: z.coerce.number().min(-180).max(180),
            }),
            response: { 200: z.object({ timezone: z.string().nullable(), approximate: z.literal(true) }) },
        },
    }, async (req, reply) => reply.status(200).send({
        timezone: timezoneForCoordinates(req.query.latitude, req.query.longitude),
        approximate: true,
    }));

    // -----------------------------------------------------------------------
    // Profiles
    // -----------------------------------------------------------------------

    typed.get('/profiles', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['profiles'],
            security: [{ bearerAuth: [] }],
            response: { 200: z.object({ profiles: z.array(BirthProfileSchema) }) },
        },
    }, async (req, reply) => {
        const rows = await profiles.listProfiles(getDb(), req.user!.id);
        return reply.status(200).send({ profiles: rows.map(profiles.toBirthProfile) });
    });

    typed.post('/profiles', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['profiles'],
            description: 'Create a birth profile. The first one completes onboarding.',
            security: [{ bearerAuth: [] }],
            body: CreateBirthProfileSchema,
            response: { 201: BirthProfileSchema },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const b = req.body;

        const existing = await profiles.listProfiles(sql, req.user!.id);
        const row = await profiles.createProfile(sql, req.user!.id, {
            ...b,
            settings: ChartSettingsSchema.parse(b.settings ?? {}),
            // The first profile is primary whatever the client asked for; an
            // account with charts but no primary one has nothing to show.
            isPrimary: existing.length === 0 ? true : b.isPrimary,
        });

        // Onboarding is complete once there is a chart to read. That is the
        // anchor for the weekly interest prompt, so the cycle starts here
        // rather than at signup — otherwise a user who abandoned registration
        // would be asked about interests they never got to use.
        if (existing.length === 0) await beginPromptCycle(sql, req.user!.id);

        return reply.status(201).send(profiles.toBirthProfile(row));
    });

    typed.get('/profiles/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['profiles'],
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            response: { 200: BirthProfileSchema },
        },
    }, async (req, reply) => {
        const row = await profiles.findProfile(getDb(), req.user!.id, req.params.id);
        if (!row) throw notFound('Profile');
        return reply.status(200).send(profiles.toBirthProfile(row));
    });

    typed.patch('/profiles/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['profiles'],
            description:
                'Update a profile. Changing calculation settings changes the chart, '
                + 'so clients should confirm before sending them.',
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            body: UpdateBirthProfileSchema,
            response: { 200: BirthProfileSchema },
        },
    }, async (req, reply) => {
        const row = await profiles.updateProfile(getDb(), req.user!.id, req.params.id, req.body);
        if (!row) throw notFound('Profile');
        return reply.status(200).send(profiles.toBirthProfile(row));
    });

    typed.delete('/profiles/:id', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['profiles'],
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
            response: { 204: z.null() },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const all = await profiles.listProfiles(sql, req.user!.id);

        // Refuse to delete the last profile. Doing so would leave the account
        // signed in with nothing to show and no obvious route back.
        if (all.length <= 1) {
            throw badRequest('Cannot delete your only birth profile');
        }

        const ok = await profiles.deleteProfile(sql, req.user!.id, req.params.id);
        if (!ok) throw notFound('Profile');
        return reply.status(204).send(null);
    });
}
