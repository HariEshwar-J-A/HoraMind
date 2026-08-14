import { z } from 'zod';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getDb } from '../db/client.js';
import * as profiles from '../repos/profiles.js';
import * as users from '../repos/users.js';
import { computeBasis } from '../services/compass.js';
import { badRequest, notFound } from '../lib/errors.js';
import { dayShape } from '../services/muhurta.js';

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
     * A coarse mark for scanning a strip of days.
     *
     * Taken from the tithi's classical five-fold class, not from Saturn. Saturn
     * was the obvious first choice and it was useless: it moves so slowly that
     * every day in a fortnight carried an identical mark, and a signal that
     * never varies is noise in the shape of information. The tithi class turns
     * over daily and is a real classical judgement about a day.
     *
     * Deliberately three states rather than a score. A number would imply a
     * precision this does not have.
     */
    mark: z.enum(['tender', 'ordinary', 'open']),

    /**
     * The day divided: sunrise, sunset, the inauspicious windows and the
     * planetary horas. Entirely arithmetic — "avoid Rahu Kaal" is advice a
     * great many people already follow and it has a fixed, checkable answer,
     * so generating it would be inventing something that has a correct value.
     */
    sunrise: z.string(),
    sunset: z.string(),
    hasRiseSet: z.boolean(),
    windows: z.array(z.object({
        name: z.string(), from: z.string(), to: z.string(),
        kind: z.enum(['avoid', 'favour']), note: z.string(),
    })),
    horas: z.array(z.object({
        lord: z.string(), from: z.string(), to: z.string(),
        good: z.string(), avoid: z.string(), current: z.boolean().optional(),
    })),
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
            response: { 200: z.object({
                days: z.array(Day),
                timezone: z.string(),
                /** The place these sunrise-relative windows are computed for. */
                placeName: z.string(),
            }) },
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

            // The tithi arrives as "Shukla 2" or "Krishna 10"; the number is
            // the classical index within the fortnight, and its position in the
            // repeating five-fold cycle is what is being read here.
            const tithiNumber = Number(basis.tithi.match(/(\d+)/)?.[1] ?? 0);
            const cycle = tithiNumber > 0 ? ((tithiNumber - 1) % 5) + 1 : 0;

            // Rikta (4th, 9th, 14th) are the "empty" tithis, classically poor
            // for beginning anything. Purna (5th, 10th, 15th) are the complete
            // ones. The remaining three carry no such reputation.
            const mark: 'tender' | 'ordinary' | 'open' =
                cycle === 4 ? 'tender'
                : cycle === 5 ? 'open'
                : 'ordinary';

            // Sunrise depends on latitude, longitude AND offset, and all three
            // have to describe the same place. Passing the *user's* zone with
            // the *profile's* coordinates gives Chennai's sunrise expressed in
            // UTC — arithmetically correct and practically nonsense. The whole
            // triple comes from the profile, and the client says which place
            // these times are for.
            const atPlace = DateTime.fromISO(date, { zone: profile.timezone });

            const shape = dayShape({
                date,
                weekday: atPlace.weekday % 7,
                lat: Number(profile.latitude),
                lon: Number(profile.longitude),
                tzOffsetMinutes: atPlace.offset,
                nowMinutes: date === today.toISODate()
                    ? DateTime.now().setZone(profile.timezone).hour * 60
                        + DateTime.now().setZone(profile.timezone).minute
                    : undefined,
            });

            days.push({
                date,
                sunrise: shape.sunrise,
                sunset: shape.sunset,
                hasRiseSet: shape.hasRiseSet,
                windows: shape.windows,
                horas: shape.horas,
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

        return reply.status(200).send({
            days,
            timezone: profile.timezone,
            placeName: profile.placeName,
        });
    });
}
