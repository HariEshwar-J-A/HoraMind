import { brass, colors } from '../../theme/tokens.js';

/**
 * Zodiacal and planetary reference data.
 *
 * Plain data, no DOM: the wheel, the dial and the timeline all read from here,
 * and a React Native port takes this file unchanged.
 *
 * Names are the Sanskrit ones because the app cites Parashara by chapter and
 * verse — a chart that says "Jupiter" beside a verse about Guru is quietly
 * asking the reader to do the translation. The English name is kept alongside
 * for anyone who needs it.
 */

export interface Rashi {
    /** 1 = Aries, matching the API's `sign` field. */
    index: number;
    english: string;
    sanskrit: string;
    glyph: string;
}

export const RASHIS: readonly Rashi[] = [
    { index: 1,  english: 'Aries',       sanskrit: 'Mesha',      glyph: '♈' },
    { index: 2,  english: 'Taurus',      sanskrit: 'Vrishabha',  glyph: '♉' },
    { index: 3,  english: 'Gemini',      sanskrit: 'Mithuna',    glyph: '♊' },
    { index: 4,  english: 'Cancer',      sanskrit: 'Karka',      glyph: '♋' },
    { index: 5,  english: 'Leo',         sanskrit: 'Simha',      glyph: '♌' },
    { index: 6,  english: 'Virgo',       sanskrit: 'Kanya',      glyph: '♍' },
    { index: 7,  english: 'Libra',       sanskrit: 'Tula',       glyph: '♎' },
    { index: 8,  english: 'Scorpio',     sanskrit: 'Vrischika',  glyph: '♏' },
    { index: 9,  english: 'Sagittarius', sanskrit: 'Dhanus',     glyph: '♐' },
    { index: 10, english: 'Capricorn',   sanskrit: 'Makara',     glyph: '♑' },
    { index: 11, english: 'Aquarius',    sanskrit: 'Kumbha',     glyph: '♒' },
    { index: 12, english: 'Pisces',      sanskrit: 'Meena',      glyph: '♓' },
] as const;

export function rashi(index: number): Rashi {
    // The API is 1-based; wrap rather than clamp so house arithmetic can add
    // freely and hand the result straight here.
    const wrapped = ((index - 1) % 12 + 12) % 12;
    // The double modulo cannot leave 0–11, but `noUncheckedIndexedAccess` has
    // no way to know that, and widening the return type would push the same
    // impossible `undefined` onto every caller.
    return RASHIS[wrapped] as Rashi;
}

/**
 * Nature, used only for colour.
 *
 * Deliberately the crude classification, not the contextual one. Real benefic
 * status depends on the ascendant, on whether the Moon is waxing, and on
 * association — none of which a colour can honestly express. Three buckets that
 * are obviously a summary beat a shading that pretends to a judgement the chart
 * has not made.
 */
export type Nature = 'benefic' | 'malefic' | 'luminary';

export interface Graha {
    name: string;
    sanskrit: string;
    glyph: string;
    nature: Nature;
    /** Vimshottari dasha length in years — the timeline reads this. */
    dashaYears: number;
}

export const GRAHAS: readonly Graha[] = [
    { name: 'Sun',     sanskrit: 'Surya',  glyph: '☉', nature: 'luminary', dashaYears: 6  },
    { name: 'Moon',    sanskrit: 'Chandra', glyph: '☽', nature: 'benefic',  dashaYears: 10 },
    { name: 'Mars',    sanskrit: 'Mangala', glyph: '♂', nature: 'malefic',  dashaYears: 7  },
    { name: 'Mercury', sanskrit: 'Budha',  glyph: '☿', nature: 'benefic',  dashaYears: 17 },
    { name: 'Jupiter', sanskrit: 'Guru',   glyph: '♃', nature: 'benefic',  dashaYears: 16 },
    { name: 'Venus',   sanskrit: 'Shukra', glyph: '♀', nature: 'benefic',  dashaYears: 20 },
    { name: 'Saturn',  sanskrit: 'Shani',  glyph: '♄', nature: 'malefic',  dashaYears: 19 },
    { name: 'Rahu',    sanskrit: 'Rahu',   glyph: '☊', nature: 'malefic',  dashaYears: 18 },
    { name: 'Ketu',    sanskrit: 'Ketu',   glyph: '☋', nature: 'malefic',  dashaYears: 7  },
] as const;

const BY_NAME = new Map(GRAHAS.map(g => [g.name, g]));

/**
 * Look up a graha, tolerating a name the engine spells differently.
 *
 * Returns a usable placeholder rather than throwing. A chart that renders eight
 * planets and one bare label is a legible bug report; a chart that throws is a
 * blank screen, and the ephemeris is the last thing anyone would suspect.
 */
export function graha(name: string): Graha {
    return BY_NAME.get(name)
        ?? { name, sanskrit: name, glyph: '·', nature: 'luminary', dashaYears: 0 };
}

export function natureColor(nature: Nature): string {
    if (nature === 'benefic') return colors.benefic;
    if (nature === 'malefic') return colors.malefic;
    return brass.light;
}

/**
 * The 27 nakshatras, each 13°20' of the ecliptic.
 *
 * Ordered from 0° Aries, so the index of a longitude is simply
 * `floor(longitude / (360 / 27))`.
 */
export const NAKSHATRAS: readonly string[] = [
    'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
    'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
    'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
    'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
    'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
] as const;

export const NAKSHATRA_ARC = 360 / 27;

export function nakshatraAt(longitude: number): { index: number; name: string; pada: number } {
    const wrapped = ((longitude % 360) + 360) % 360;
    // `min` guards the boundary: a longitude of exactly 360 would floor to 27.
    const index = Math.min(Math.floor(wrapped / NAKSHATRA_ARC), 26);
    // Each nakshatra divides into four padas of 3°20'.
    const pada = Math.floor((wrapped - index * NAKSHATRA_ARC) / (NAKSHATRA_ARC / 4)) + 1;
    return { index, name: NAKSHATRAS[index] as string, pada };
}
