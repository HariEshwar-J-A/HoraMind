import { DateTime } from 'luxon';
import { getEngine } from '../lib/engine.js';
import { contextFor, natalChart, ashtakavarga, dashaTree, type ChartContext } from './charts.js';
import type { ProfileRow } from '../repos/profiles.js';

/**
 * The computed context handed to the AI layer.
 *
 * Everything an interpretation is allowed to rest on, resolved before the model
 * is called. The model presents these; it does not derive them, and it has no
 * tool that could.
 */

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
               'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const LEVEL_NAME = ['', 'Mahadasha', 'Antardasha', 'Pratyantardasha', 'Sookshma', 'Prana'];

/** Houses from a dasha lord in which a sub-lord is classically benefic or malefic. */
const FAVOURABLE_FROM_LORD = [1, 2, 4, 5, 7, 9, 10, 11];
const ADVERSE_FROM_LORD    = [6, 8, 12];

const signOf = (lon: number) => Math.floor(lon / 30) + 1;
const houseFrom = (from: number, to: number) => ((((to - from) % 12) + 12) % 12) + 1;

interface DashaNode {
    level: number;
    planet: string;
    start: string;
    end: string;
    subPeriods?: DashaNode[];
}

/**
 * Walk the dasha tree down to whichever period contains `asOf`.
 *
 * `houseFromLordAbove` is computed at each level and is the single most
 * important number in the whole payload: classical dasha verses are almost
 * always conditional on where the sub-lord sits relative to the lord above it,
 * and quoting a verse without resolving that condition inverts the reading
 * roughly half the time.
 */
export function dashaStackAt(ctx: ChartContext, asOf: DateTime, depth = 3) {
    const tree = dashaTree(ctx, depth) as unknown as DashaNode[];
    const planets = getEngine().getPlanets(ctx.dt, ctx.location, ctx.opts);
    const natalBy = new Map(planets.map(p => [p.name, p]));

    const stack: Array<Record<string, unknown>> = [];
    let level: DashaNode[] = tree.filter(p => p.level === 1);
    let parentLord: string | null = null;

    while (level.length) {
        const current = level.find(p =>
            asOf >= DateTime.fromISO(String(p.start)) && asOf < DateTime.fromISO(String(p.end)));
        if (!current) break;

        const lordNatal = natalBy.get(current.planet);
        const lordSign = lordNatal ? signOf(lordNatal.longitude) : null;

        let fromParent: number | null = null;
        let branch: string | null = null;

        if (parentLord && lordSign !== null) {
            const parentNatal = natalBy.get(parentLord);
            if (parentNatal) {
                fromParent = houseFrom(signOf(parentNatal.longitude), lordSign);
                branch = ADVERSE_FROM_LORD.includes(fromParent) ? 'adverse'
                       : FAVOURABLE_FROM_LORD.includes(fromParent) ? 'favourable'
                       : 'mixed';
            }
        }

        stack.push({
            level: current.level,
            levelName: LEVEL_NAME[current.level] ?? `L${current.level}`,
            lord: current.planet,
            start: current.start,
            end: current.end,
            yearsRemaining: +DateTime.fromISO(String(current.end))
                .diff(asOf, 'years').years.toFixed(3),
            lordNatalSign: lordSign ? SIGNS[lordSign - 1] : null,
            // Null at Mahadasha, which has no lord above it.
            houseFromLordAbove: fromParent,
            classicalBranch: branch,
        });

        parentLord = current.planet;
        level = current.subPeriods ?? [];
    }

    return stack;
}

/** Gochara: where the planets are now, relative to this chart. */
export function transitsAt(ctx: ChartContext, asOf: DateTime, natalMoonSign: number, ascSign: number) {
    const engine = getEngine();
    const transiting = engine.getPlanets(asOf, ctx.location, ctx.opts);
    const natal = engine.getPlanets(ctx.dt, ctx.location, ctx.opts);
    const { sav } = ashtakavarga(ctx).sav.reduce(
        (acc, s) => { acc.sav[s.sign - 1] = s.bindus; return acc; },
        { sav: new Array<number>(12).fill(0) },
    );

    const planets = transiting.map(p => {
        const sign = signOf(p.longitude);
        const natalCounterpart = natal.find(n => n.name === p.name);
        return {
            name: p.name,
            signName: SIGNS[sign - 1],
            degree: +(p.longitude % 30).toFixed(2),
            retrograde: p.speed < 0,
            houseFromMoon: houseFrom(natalMoonSign, sign),
            houseFromLagna: houseFrom(ascSign, sign),
            // Below roughly 25 bindus a transit tends to disappoint whatever
            // its nature, so this weights every other statement about it.
            savBindus: sav[sign - 1],
            isReturn: natalCounterpart ? sign === signOf(natalCounterpart.longitude) : false,
        };
    });

    const saturn = planets.find(p => p.name === 'Saturn');
    const satFromMoon = saturn?.houseFromMoon ?? 0;

    return {
        planets,
        // Three distinct afflictions from the same body. Conflating them is a
        // common and consequential error: Sade Sati is seven and a half years,
        // Kantaka Shani is not.
        saturnCycle: {
            sadeSati: [12, 1, 2].includes(satFromMoon),
            phase: satFromMoon === 12 ? 'rising'
                 : satFromMoon === 1 ? 'peak'
                 : satFromMoon === 2 ? 'setting' : null,
            kantakaShani: [4, 7, 10].includes(satFromMoon),
            ashtamaShani: satFromMoon === 8,
            houseFromMoon: satFromMoon,
        },
    };
}

/** Everything the model receives about a chart, for one moment. */
export function buildFacts(profile: ProfileRow, asOf: DateTime, depth = 3) {
    const ctx = contextFor(profile);
    const natal = natalChart(ctx);

    const moon = natal.planets.find(p => p.name === 'Moon');
    const moonSign = moon?.sign ?? 1;

    return {
        asOf: asOf.toISO(),
        birthTimeAccuracy: profile.timeAccuracy,
        natal,
        dashaStack: dashaStackAt(ctx, asOf, depth),
        transits: transitsAt(ctx, asOf, moonSign, natal.ascendant.sign),
        ashtakavarga: ashtakavarga(ctx),
        guidance: {
            rule: 'Dasha promises, transit delivers, the natal chart decides whether '
                + 'anything was on offer. A transit cannot deliver what the chart and '
                + 'dasha do not support.',
            note: 'houseFromLordAbove selects which conditional branch of a classical '
                + 'dasha verse applies; classicalBranch names it.',
        },
    };
}
