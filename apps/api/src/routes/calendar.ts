import { z } from 'zod';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getDb } from '../db/client.js';
import * as profiles from '../repos/profiles.js';
import * as users from '../repos/users.js';
import { computeBasis } from '../services/compass.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * A week either side of today.
 *
 * Entirely deterministic: panchanga and transits for each day, computed from
 * the ephemeris, with no model involved. That is the whole design of this
 * endpoint. Fifteen days of generated prose would be fifteen paid completions
 * for a screen most people scroll past, so the calendar computes the facts for
 * the range and `/v1/compass` stays the one place a day gets written up — on
 * demand, for the day actually chosen.
 *
 * The forward half is labelled `transit`, never `forecast`. The distinction is
 * the product's whole claim: where a planet will be is arithmetic, and what it
 * means for someone is not.
 */

const MAX_SPAN_DAYS = 31;

const Query = z.object({
    profileId: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const Day = z.object({
    date: z.string(),
    /** Where the day sits relative to the user's today, in their own timezone. */
    relation: z.enum(['past', 'today', 'future']),
    vara: z.string(),
    tithi: z.string(),
    nakshatra: z.string(),
    yoga: z.string(),
    karana: z.string(),
    dasha: z.array(z.string()),
    transits: z.array(z.string()),
    /**
     * A coarse mark for scanning a strip of days. Derived from Saturn's
     * relationship to the Moon only — the one factor classical texts treat as
     * dominant for a day's texture — and deliberately not a score. A number
     * would imply a precision the computation does not have.
     */
    mark: z.enum(['tender', 'ordinary', 'open']),
});

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/calendar', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['charts'],
            description:
                'Panchanga and transits for a range of days. Deterministic — no model is called.',
            security: [{ bearerAuth: [] }],
            querystring: Query,
            response: { 200: z.object({ days: z.array(Day), timezone: z.string() }) },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const userId = req.user!.id;

        const user = await users.findUserById(sql, userId);
        if (!user) throw notFound('User');

        const profile = req.query.profileId
            ? await profiles.findProfile(sql, userId, req.query.profileId)
            : await profiles.findPrimaryProfile(sql, userId);
        if (!profile) throw notFound('Birth profile');

        const zone = user.timezone;
        const today = DateTime.now().setZone(zone).startOf('day');

        const from = req.query.from
            ? DateTime.fromISO(req.query.from, { zone })
            : today.minus({ days: 7 });
        const to = req.query.to
            ? DateTime.fromISO(req.query.to, { zone })
            : today.plus({ days: 7 });

        if (!from.isValid || !to.isValid) throw badRequest('from and to must be YYYY-MM-DD dates');
        if (to < from) throw badRequest('`to` falls before `from`');

        const span = to.diff(from, 'days').days + 1;
        // Each day is an ephemeris evaluation; an unbounded range is a way to
        // make one request cost minutes of CPU.
        if (span > MAX_SPAN_DAYS) {
            throw badRequest(`Range is ${Math.round(span)} days; the maximum is ${MAX_SPAN_DAYS}`);
        }

        const days = [];
        for (let d = from; d <= to; d = d.plus({ days: 1 })) {
            const date = d.toISODate()!;
            const basis = computeBasis(profile, date, zone);

            const houseFromMoon = basis.saturnCycle?.houseFromMoon ?? null;
            // 1, 8 and 12 from the Moon are the classical hard placements for
            // Saturn; 3, 6 and 11 are the upachaya houses where it is said to
            // do well. Everything else is unremarkable, and saying so is more
            // honest than manufacturing a gradient.
            const mark: 'tender' | 'ordinary' | 'open' =
                houseFromMoon === null ? 'ordinary'
                : [1, 8, 12].includes(houseFromMoon) ? 'tender'
                : [3, 6, 11].includes(houseFromMoon) ? 'open'
                : 'ordinary';

            days.push({
                date,
                relation: date === today.toISODate() ? 'today' as const
                    : d < today ? 'past' as const : 'future' as const,
                vara: basis.vara,
                tithi: basis.tithi,
                nakshatra: basis.nakshatra,
                yoga: basis.yoga,
                karana: basis.karana,
                dasha: basis.currentDasha,
                transits: basis.notableTransits,
                mark,
            });
        }

        return reply.status(200).send({ days, timezone: zone });
    });
}
