import { DateTime } from 'luxon';
import {
    calculateHouseCusps, calculateVarga, calculatePanchanga,
} from '@node-jhora/core';
import { Ashtakavarga } from '@node-jhora/analytics';
import { generateVimshottari } from '@node-jhora/prediction';

import { getEngine } from '../lib/engine.js';
import { toCalendarDate, type ProfileRow } from '../repos/profiles.js';
import { badRequest } from '../lib/errors.js';

/**
 * Chart computation.
 *
 * A thin, deliberate layer over node-jhora: it translates a stored profile into
 * engine arguments and nothing else. No interpretation happens here, and no
 * defaults are invented — every setting comes from the profile row, because a
 * chart must reproduce identically for the life of the account.
 */

/** API ayanamsa names to Swiss Ephemeris mode numbers, as node-jhora uses them. */
const AYANAMSA_MODE: Record<string, number> = {
    true_chitra: 27, true_pushya: 29, true_revati: 30, true_mula: 35,
    lahiri: 1, lahiri_icrc: 2, raman: 3, kp: 5, yukteshwar: 7, fagan_bradley: 0,
};

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
               'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const signOf = (lon: number) => Math.floor(lon / 30) + 1;
const houseFrom = (from: number, to: number) => ((((to - from) % 12) + 12) % 12) + 1;

export interface ChartContext {
    dt: DateTime;
    location: { latitude: number; longitude: number };
    opts: {
        ayanamsaOrder: number;
        nodeType: 'mean' | 'true';
        positionMode: 'geometric' | 'apparent';
    };
    houseSystem: string;
    profile: ProfileRow;
}

/**
 * Turn a stored profile into engine arguments.
 *
 * The birth moment is constructed in the *birth* timezone, not the server's and
 * not the user's current one. Someone born in Chennai who now lives in Berlin
 * still has a Chennai birth chart; resolving the instant in the wrong zone
 * would shift it by the whole offset.
 */
export function contextFor(profile: ProfileRow): ChartContext {
    const dt = DateTime.fromISO(
        `${toCalendarDate(profile.birthDate)}T${profile.birthTime}`,
        { zone: profile.timezone },
    );

    if (!dt.isValid) {
        throw badRequest(`Birth moment is not a valid instant: ${dt.invalidReason}`);
    }

    const ayanamsaOrder = AYANAMSA_MODE[profile.ayanamsa];
    if (ayanamsaOrder === undefined) {
        throw badRequest(`Unknown ayanamsa: ${profile.ayanamsa}`);
    }

    return {
        dt,
        location: { latitude: Number(profile.latitude), longitude: Number(profile.longitude) },
        opts: {
            ayanamsaOrder,
            nodeType: profile.nodeType as 'mean' | 'true',
            positionMode: profile.positionMode as 'geometric' | 'apparent',
        },
        houseSystem: profile.houseSystem,
        profile,
    };
}

export function natalChart(ctx: ChartContext) {
    const engine = getEngine();
    const planets = engine.getPlanets(ctx.dt, ctx.location, ctx.opts);
    const houses = calculateHouseCusps(
        ctx.dt, ctx.location.latitude, ctx.location.longitude,
        ctx.houseSystem as never, engine, ctx.opts.ayanamsaOrder, 0,
    );

    const ascSign = signOf(houses.ascendant);

    return {
        ascendant: {
            longitude: houses.ascendant,
            sign: ascSign,
            signName: SIGNS[ascSign - 1],
            degree: +(houses.ascendant % 30).toFixed(4),
        },
        // An unknown birth time makes the ascendant and every house placement
        // meaningless. Flagged here so no client can present them as certain.
        houseAccuracy: ctx.profile.timeAccuracy,
        houses: houses.cusps ?? [],
        planets: planets.map(p => {
            const sign = signOf(p.longitude);
            return {
                name: p.name,
                longitude: p.longitude,
                sign,
                signName: SIGNS[sign - 1],
                degree: +(p.longitude % 30).toFixed(4),
                house: houseFrom(ascSign, sign),
                retrograde: p.speed < 0,
                speed: p.speed,
            };
        }),
        meta: {
            ayanamsa: ctx.profile.ayanamsa,
            ayanamsaValue: engine.getAyanamsa(engine.julday(ctx.dt), ctx.opts.ayanamsaOrder),
            nodeType: ctx.profile.nodeType,
            positionMode: ctx.profile.positionMode,
            houseSystem: ctx.profile.houseSystem,
            engine: 'node-jhora / JPL DE440s',
        },
    };
}

/** Divisional charts. `divisions` are varga numbers: 1, 2, 3, 4, 7, 9, 10, 12, … */
export function vargaCharts(ctx: ChartContext, divisions: number[]) {
    const engine = getEngine();
    const planets = engine.getPlanets(ctx.dt, ctx.location, ctx.opts);

    return divisions.map(d => ({
        division: d,
        planets: planets.map(p => {
            const v = calculateVarga(p.longitude, d);
            return {
                name: p.name,
                sign: v.sign,
                signName: SIGNS[(v.sign - 1) % 12],
                degree: 'degree' in v ? v.degree : null,
            };
        }),
    }));
}

export function panchanga(ctx: ChartContext) {
    const planets = getEngine().getPlanets(ctx.dt, ctx.location, ctx.opts);
    const sun = planets.find(p => p.name === 'Sun');
    const moon = planets.find(p => p.name === 'Moon');
    if (!sun || !moon) throw new Error('Sun or Moon missing from computed positions');

    // The Vedic day begins at sunrise, so the weekday depends on it. 6.0 is a
    // placeholder: true local sunrise needs a rise/set computation node-jhora
    // does not currently expose, and near the poles or at the day boundary this
    // will name the wrong vara.
    return calculatePanchanga(sun.longitude, moon.longitude, ctx.dt, 6.0);
}

export function ashtakavarga(ctx: ChartContext) {
    const planets = getEngine().getPlanets(ctx.dt, ctx.location, ctx.opts);
    const { sav } = Ashtakavarga.calculateSAV(planets);
    return {
        sav: sav.map((bindus: number, i: number) => ({
            sign: i + 1, signName: SIGNS[i], bindus,
        })),
    };
}

/*
 * Shadbala is deliberately not exposed yet.
 *
 * `calculateShadbala` takes a per-planet input requiring true local sunrise and
 * sunset, plus a `VargaInfo[]` carrying each divisional lord and the rashi that
 * lord occupies. Neither is available from the engine's public surface today,
 * and assembling them by guesswork would produce six strength values that look
 * authoritative and are unverified.
 *
 * For an application whose entire premise is that the computation is correct,
 * a missing endpoint is much cheaper than a confidently wrong one. Restoring it
 * needs a rise/set helper in node-jhora and the varga-lord mapping checked
 * against that package's own tests.
 */

/**
 * Vimshottari dasha tree.
 *
 * Depth 3 reaches Pratyantardasha, which is the level an actual reading needs —
 * a Mahadasha alone spans up to twenty years and says almost nothing about the
 * question someone is asking today.
 */
export function dashaTree(ctx: ChartContext, depth: number) {
    const planets = getEngine().getPlanets(ctx.dt, ctx.location, ctx.opts);
    const moon = planets.find(p => p.name === 'Moon');
    if (!moon) throw new Error('Moon missing from computed positions');
    return generateVimshottari(ctx.dt, moon.longitude, depth);
}
