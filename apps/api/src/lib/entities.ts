/**
 * Entity extraction over closed astrological vocabularies.
 *
 * Retrieval quality in this corpus turns on a specific failure: "what does
 * Rahu in the 9th mean?" embeds close to hundreds of passages about Rahu, about
 * the 9th house, and about neither in particular. Cosine distance alone cannot
 * tell which of them is *about* the pair.
 *
 * The fix is a soft boost, not a hard `where` filter. A filter would return
 * nothing when the question names an entity the corpus happens not to tag —
 * "what happens on a Sunday?" has no matching metadata and would come back
 * empty rather than merely unfocused.
 *
 * These vocabularies are closed and written out in full. The richer bilingual
 * lexicon lives in JyotishBase's `injest-scripts/lib/entities.mjs`; it belongs
 * in a shared package eventually, and until then this covers the terms that
 * actually change ranking.
 */

export type EntityTag = string;

const PLANETS: Record<string, string> = {
    sun: 'sun', surya: 'sun', ravi: 'sun',
    moon: 'moon', chandra: 'moon', soma: 'moon',
    mars: 'mars', mangal: 'mars', kuja: 'mars', angaraka: 'mars',
    mercury: 'mercury', budha: 'mercury',
    jupiter: 'jupiter', guru: 'jupiter', brihaspati: 'jupiter',
    venus: 'venus', shukra: 'venus', sukra: 'venus',
    saturn: 'saturn', shani: 'saturn', sani: 'saturn',
    rahu: 'rahu',
    ketu: 'ketu',
};

const SIGNS: Record<string, string> = {
    aries: 'aries', mesha: 'aries',
    taurus: 'taurus', vrishabha: 'taurus',
    gemini: 'gemini', mithuna: 'gemini',
    cancer: 'cancer', karka: 'cancer', kataka: 'cancer',
    leo: 'leo', simha: 'leo',
    virgo: 'virgo', kanya: 'virgo',
    libra: 'libra', tula: 'libra',
    scorpio: 'scorpio', vrischika: 'scorpio',
    sagittarius: 'sagittarius', dhanus: 'sagittarius',
    capricorn: 'capricorn', makara: 'capricorn',
    aquarius: 'aquarius', kumbha: 'aquarius',
    pisces: 'pisces', meena: 'pisces',
};

const ORDINAL_HOUSE: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
    '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6,
    '7th': 7, '8th': 8, '9th': 9, '10th': 10, '11th': 11, '12th': 12,
};

/** Divisional charts BPHS actually defines. */
const VALID_DIVISIONS = new Set([1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60]);

const DIVISION_NAMES: Record<string, number> = {
    rasi: 1, rashi: 1, hora: 2, drekkana: 3, dreshkana: 3, chaturthamsa: 4,
    saptamsa: 7, navamsa: 9, navamsha: 9, dasamsa: 10, dashamsa: 10,
    dwadasamsa: 12, shodasamsa: 16, vimsamsa: 20, chaturvimsamsa: 24,
    bhamsa: 27, trimsamsa: 30, khavedamsa: 40, akshavedamsa: 45,
    shashtiamsa: 60, shashtyamsa: 60,
};

const DASHA_TERMS: Record<string, string> = {
    dasha: 'dasha', dasa: 'dasha', mahadasha: 'dasha', antardasha: 'dasha',
    antardasa: 'dasha', pratyantardasha: 'dasha', bhukti: 'dasha',
    vimshottari: 'dasha',
    transit: 'transit', gochara: 'transit',
};

/**
 * Extract metadata tags a question is about.
 *
 * Matching is on whole words. Substring matching was the original cause of
 * false positives here — "ketu" inside "keturatna", "leo" inside "galileo" —
 * so tokenisation happens first and lookups are exact.
 */
export function extractEntities(query: string): EntityTag[] {
    const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const found = new Set<EntityTag>();

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!;

        if (PLANETS[t]) found.add(`planet_${PLANETS[t]}`);
        if (SIGNS[t]) found.add(`sign_${SIGNS[t]}`);
        if (DASHA_TERMS[t]) found.add(`topic_${DASHA_TERMS[t]}`);

        // "D9" — one token.
        const dMatch = /^d(\d{1,2})$/.exec(t);
        if (dMatch) {
            const n = Number(dMatch[1]);
            if (VALID_DIVISIONS.has(n)) found.add(`division_${n}`);
        }

        // "D-10" and "D 10" — two tokens, because the tokeniser drops the
        // hyphen. This is the form JHora itself uses ("D-10 (5-8)"), so it is
        // the common case in anything quoted from the software, not an edge one.
        if (t === 'd') {
            const following = tokens[i + 1];
            if (following && /^\d{1,2}$/.test(following)) {
                const n = Number(following);
                if (VALID_DIVISIONS.has(n)) found.add(`division_${n}`);
            }
        }

        if (DIVISION_NAMES[t]) found.add(`division_${DIVISION_NAMES[t]}`);

        // "9th house", "ninth house" — only when the word "house" or "bhava"
        // follows, so "the 9th lord" and a bare year like "1998" do not become
        // house references.
        const ordinal = ORDINAL_HOUSE[t];
        const next = tokens[i + 1];
        if (ordinal && (next === 'house' || next === 'bhava')) {
            found.add(`house_${ordinal}`);
        }
    }

    return [...found];
}
