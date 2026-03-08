/**
 * calculate_chart.js
 * Tool 1 – Astrological calculation switchboard for OpenClaw.
 *
 * Input:
 *   {
 *     date:             string  — "YYYY-MM-DD"  (local date)
 *     time:             string  — "HH:MM:SS"    (local time)
 *     lat:              number  — geographic latitude  (decimal degrees)
 *     lon:              number  — geographic longitude (decimal degrees)
 *     ayanamsa:         string  — "LAHIRI" | "RAMAN" | "KP" | "YUKTESHWAR" | "TRUE_PUSHYA"
 *     calculation_type: string  — "CORE_CHARTS" | "VARGAS" | "ASHTAKAVARGA" | "DASHA"
 *     timezone?:        string  — IANA zone (e.g. "Asia/Kolkata"). Defaults to lon-based estimate.
 *   }
 *
 * Returns: compact JSON object — shape depends on calculation_type.
 *
 * CONSTRAINT: Never returns all calculation types at once. Each call handles
 *             exactly one type. Keeps the LLM context window small.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

// ---------------------------------------------------------------------------
// Resolve node-jhora package paths (sibling repo on same VM)
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const JHORA      = path.resolve(__dirname, '../../node-jhora/packages');

const coreURL       = pathToFileURL(path.join(JHORA, 'core/dist/index.js')).href;
const analyticsURL  = pathToFileURL(path.join(JHORA, 'analytics/dist/index.js')).href;
const predictionURL = pathToFileURL(path.join(JHORA, 'prediction/dist/index.js')).href;

// Dynamic imports so we can use top-level await in ESM
const { EphemerisEngine, calculateVarga, calculateHouseCusps, AYANAMSA }
    = await import(coreURL);

const { calculateShadbala, Ashtakavarga }
    = await import(analyticsURL);

const { generateVimshottari }
    = await import(predictionURL);

// Luxon is a dep of @node-jhora/core — import directly from it
const { DateTime } = await import('luxon');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps user-facing ayanamsa strings → SE code */
const AYANAMSA_MAP = {
    LAHIRI:       AYANAMSA.LAHIRI,        // 1
    RAMAN:        AYANAMSA.RAMAN,         // 3
    KP:           AYANAMSA.KRISHNAMURTI,  // 5
    KRISHNAMURTI: AYANAMSA.KRISHNAMURTI,  // 5
    YUKTESHWAR:   AYANAMSA.YUKTESHWAR,    // 7
    TRUE_PUSHYA:  AYANAMSA.TRUE_PUSHYA,   // 29
};

/** Planet IDs: 0=Sun 1=Moon 2=Mercury 3=Venus 4=Mars 5=Jupiter 6=Saturn 7=Rahu 8=Ketu */
const PLANET_NAMES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Rahu','Ketu'];

/** Rashi sign lords (sign index 0-based → planet ID) */
const SIGN_LORD = [4,3,2,1,0,2,3,4,5,6,6,5]; // Aries…Pisces

/** Divisional numbers for VARGAS mode (D2–D30 selection) */
const VARGA_DIVISIONS = [2, 4, 10, 12, 16, 20, 24, 27, 30];

/** Sapta Vargas (7 charts used for Saptavargaja Bala in Shadbala) */
const SAPTA_VARGAS = [1, 2, 3, 7, 9, 12, 30];
const SAPTA_NAMES  = ['D1','D2','D3','D7','D9','D12','D30'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Luxon DateTime from user input, respecting timezone.
 * If timezone is not provided, estimate from longitude (lon/15 hours).
 */
function buildDateTime(date, time, lon, timezone) {
    if (timezone) {
        return DateTime.fromISO(`${date}T${time}`, { zone: timezone });
    }
    // Fallback: estimate UTC offset from geographic longitude
    const offsetHours = Math.round(lon / 15);
    const offsetStr   = offsetHours >= 0
        ? `+${String(offsetHours).padStart(2,'0')}:00`
        : `-${String(Math.abs(offsetHours)).padStart(2,'0')}:00`;
    return DateTime.fromISO(`${date}T${time}${offsetStr}`);
}

/** Format a planet array into a compact sign+degree map keyed by name */
function formatPlanets(planets) {
    return Object.fromEntries(
        planets.map(p => [
            PLANET_NAMES[p.id] ?? `P${p.id}`,
            {
                lon:   +p.longitude.toFixed(4),
                sign:  Math.floor(p.longitude / 30) + 1,   // 1-12
                deg:   +(p.longitude % 30).toFixed(4),
                spd:   +p.speed.toFixed(6),
                retro: p.speed < 0,
            }
        ])
    );
}

/** Format D-chart varga point for a planet as { sign, deg } */
function formatVarga(vp) {
    return { sign: vp.sign, deg: +vp.degree.toFixed(4) };
}

/**
 * Build VargaInfo[] (sapta vargas) for Saptavargaja Bala.
 * Each VargaInfo: { vargaName, sign (1-12), lordId, lordRashiSign (1-12) }
 */
function buildSaptaVargaInfo(planet, allPlanets) {
    return SAPTA_VARGAS.map((div, i) => {
        const vp      = calculateVarga(planet.longitude, div);
        const signIdx = vp.sign - 1;                          // 0-indexed for SIGN_LORD
        const lordId  = SIGN_LORD[signIdx];
        const lord    = allPlanets.find(p => p.id === lordId);
        const lordRashiSign = lord
            ? Math.floor(lord.longitude / 30) + 1             // 1-indexed
            : 1;
        return { vargaName: SAPTA_NAMES[i], sign: vp.sign, lordId, lordRashiSign };
    });
}

/** Approximate sunrise/sunset from lat (good enough for Shadbala timing) */
function estimateSunriseSunset(lat) {
    // Simple approximation: sunrise ≈ 6 ± δ, sunset ≈ 18 ± δ based on latitude
    const latFactor = Math.abs(lat) / 90;          // 0 → 1 as we go to poles
    const delta     = latFactor * 1.5;             // up to 1.5 hours offset at extreme lat
    return {
        sunrise: 6 - delta,
        sunset:  18 + delta,
    };
}

// ---------------------------------------------------------------------------
// Calculation modes
// ---------------------------------------------------------------------------

/**
 * CORE_CHARTS: D1 positions + D9 (Navamsa) + Shadbala for 7 planets.
 */
async function calcCoreCharts(engine, birthDt, location, ayanamsaOrder) {
    const planets = engine.getPlanets(birthDt.toUTC(), location, {
        ayanamsaOrder, topocentric: true, nodeType: 'mean',
    });
    const houses  = calculateHouseCusps(birthDt.toUTC(), location.latitude, location.longitude,
        'WholeSign', engine);

    const ascSign = Math.floor(houses.ascendant / 30) + 1; // 1-12

    // D9 (Navamsa) positions
    const d9 = Object.fromEntries(
        planets.map(p => [
            PLANET_NAMES[p.id] ?? `P${p.id}`,
            formatVarga(calculateVarga(p.longitude, 9)),
        ])
    );

    // Shadbala for 7 classic planets (IDs 0-6)
    const { sunrise, sunset } = estimateSunriseSunset(location.latitude);
    const birthHour = birthDt.hour + birthDt.minute / 60;
    const sun  = planets.find(p => p.id === 0);
    const moon = planets.find(p => p.id === 1);

    const shadbala = {};
    const SHADBALA_PLANETS = [0, 1, 2, 3, 4, 5, 6]; // Sun…Saturn
    for (const pid of SHADBALA_PLANETS) {
        const planet = planets.find(p => p.id === pid);
        if (!planet || !sun || !moon) continue;
        try {
            const result = calculateShadbala({
                planet,
                allPlanets: planets,
                houses: {
                    cusps: houses.cusps,
                    ascendant: houses.ascendant,
                    mc: houses.mc,
                    armc: houses.armc,
                    vertex: houses.vertex ?? 0,
                },
                sun, moon,
                timeDetails: { sunrise, sunset, birthHour },
                vargaPositions: buildSaptaVargaInfo(planet, planets),
            });
            shadbala[PLANET_NAMES[pid]] = {
                total:     +result.total.toFixed(3),
                sthana:    +result.sthana.toFixed(3),
                dig:       +result.dig.toFixed(3),
                kaala:     +result.kaala.toFixed(3),
                chesta:    +result.chesta.toFixed(3),
                naisargika:+result.naisargika.toFixed(3),
                drig:      +result.drig.toFixed(3),
            };
        } catch (err) {
            shadbala[PLANET_NAMES[pid]] = { error: err.message };
        }
    }

    return {
        calculation_type: 'CORE_CHARTS',
        ascendant: { sign: ascSign, lon: +houses.ascendant.toFixed(4) },
        d1: formatPlanets(planets),
        d9,
        shadbala,
    };
}

/**
 * VARGAS: D2, D4, D10, D12, D16, D20, D24, D27, D30 for all planets.
 */
async function calcVargas(engine, birthDt, location, ayanamsaOrder) {
    const planets = engine.getPlanets(birthDt.toUTC(), location, {
        ayanamsaOrder, topocentric: true, nodeType: 'mean',
    });

    const result = { calculation_type: 'VARGAS' };
    for (const div of VARGA_DIVISIONS) {
        const key = `D${div}`;
        result[key] = Object.fromEntries(
            planets.map(p => [
                PLANET_NAMES[p.id] ?? `P${p.id}`,
                formatVarga(calculateVarga(p.longitude, div)),
            ])
        );
    }
    return result;
}

/**
 * ASHTAKAVARGA: Sarva Ashtakavarga (SAV) bindu scores per house + per-planet BAV.
 */
async function calcAshtakavarga(engine, birthDt, location, ayanamsaOrder) {
    const planets = engine.getPlanets(birthDt.toUTC(), location, {
        ayanamsaOrder, topocentric: true, nodeType: 'mean',
    });
    const houses = calculateHouseCusps(birthDt.toUTC(), location.latitude, location.longitude,
        'WholeSign', engine);

    // Add Lagna as pseudo-planet (ID 99) required by AshtakavargaCalculator
    const lagnaLon   = houses.ascendant;
    const withLagna  = [...planets, { id: 99, longitude: lagnaLon, name: 'Lagna' }];

    const { bav, sav } = Ashtakavarga.calculateSAV(withLagna);

    const SIGN_NAMES = ['Ari','Tau','Gem','Can','Leo','Vir','Lib','Sco','Sag','Cap','Aqu','Pis'];

    // Map SAV to house numbers (Whole Sign: house 1 = Lagna sign)
    const lagnaSignIdx = Math.floor(lagnaLon / 30); // 0-based
    const savByHouse   = {};
    for (let h = 1; h <= 12; h++) {
        const signIdx = (lagnaSignIdx + h - 1) % 12;
        savByHouse[`H${h}`] = {
            sign:   SIGN_NAMES[signIdx],
            bindus: sav[signIdx],
        };
    }

    // Per-planet BAV (compact)
    const bavByPlanet = {};
    const BAV_PLANET_IDS = [0, 1, 4, 2, 5, 3, 6]; // Sun Moon Mars Merc Jup Ven Sat
    for (const pid of BAV_PLANET_IDS) {
        if (bav[pid]) {
            bavByPlanet[PLANET_NAMES[pid]] = bav[pid]; // [12 scores, sign 0-indexed Aries=0]
        }
    }

    return {
        calculation_type: 'ASHTAKAVARGA',
        sav_by_house: savByHouse,
        bav_by_planet: bavByPlanet,
    };
}

/**
 * DASHA: Vimshottari Dasha timeline (Mahadasha + Antardasha).
 * Returns periods spanning 10 years before now → 20 years from now.
 */
async function calcDasha(engine, birthDt, location, ayanamsaOrder) {
    const planets = engine.getPlanets(birthDt.toUTC(), location, {
        ayanamsaOrder, topocentric: true, nodeType: 'mean',
    });
    const moon = planets.find(p => p.id === 1);
    if (!moon) throw new Error('Moon position unavailable — cannot compute Dasha.');

    // Generate full 120-year tree at depth 2 (Mahadasha + Antardasha)
    const tree   = generateVimshottari(birthDt, moon.longitude, 2);
    const now    = DateTime.now();
    const cutOff = { past: now.minus({ years: 10 }), future: now.plus({ years: 20 }) };

    // Filter to the relevant window and serialize
    const periods = tree
        .filter(maha => {
            const mahaEnd   = maha.end;
            const mahaStart = maha.start;
            return mahaEnd > cutOff.past && mahaStart < cutOff.future;
        })
        .map(maha => ({
            planet:   maha.planet,
            level:    maha.level,
            start:    maha.start.toISODate(),
            end:      maha.end.toISODate(),
            duration: +maha.durationYears.toFixed(3),
            antardashas: (maha.subPeriods ?? [])
                .filter(a => a.end > cutOff.past && a.start < cutOff.future)
                .map(a => ({
                    planet:   a.planet,
                    start:    a.start.toISODate(),
                    end:      a.end.toISODate(),
                    duration: +a.durationYears.toFixed(4),
                })),
        }));

    return {
        calculation_type: 'DASHA',
        moon_longitude:   +moon.longitude.toFixed(6),
        window:           { from: cutOff.past.toISODate(), to: cutOff.future.toISODate() },
        periods,
    };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {string} input.date             — "YYYY-MM-DD"
 * @param {string} input.time             — "HH:MM:SS"
 * @param {number} input.lat
 * @param {number} input.lon
 * @param {string} input.ayanamsa         — e.g. "LAHIRI"
 * @param {string} input.calculation_type — "CORE_CHARTS"|"VARGAS"|"ASHTAKAVARGA"|"DASHA"
 * @param {string} [input.timezone]       — IANA zone string (optional)
 * @returns {Promise<object>}
 */
export async function calculateChart(input) {
    const { date, time, lat, lon, ayanamsa = 'LAHIRI', calculation_type, timezone } = input;

    // --- Validate ---
    if (!date || !time || lat == null || lon == null) {
        throw new Error('Missing required fields: date, time, lat, lon');
    }
    const VALID_TYPES = ['CORE_CHARTS', 'VARGAS', 'ASHTAKAVARGA', 'DASHA'];
    if (!VALID_TYPES.includes(calculation_type)) {
        throw new Error(`Invalid calculation_type "${calculation_type}". Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const ayanamsaOrder = AYANAMSA_MAP[ayanamsa.toUpperCase()];
    if (ayanamsaOrder == null) {
        throw new Error(`Unknown ayanamsa "${ayanamsa}". Valid: ${Object.keys(AYANAMSA_MAP).join(', ')}`);
    }

    // --- Build DateTime ---
    const birthDt = buildDateTime(date, time, lon, timezone);
    if (!birthDt.isValid) {
        throw new Error(`Invalid date/time: ${birthDt.invalidExplanation}`);
    }

    const location = { latitude: lat, longitude: lon };

    // --- Initialize WASM engine ---
    const engine = EphemerisEngine.getInstance();
    await engine.initialize();
    engine.setAyanamsa(ayanamsaOrder);

    // --- Dispatch ---
    switch (calculation_type) {
        case 'CORE_CHARTS':   return calcCoreCharts(engine, birthDt, location, ayanamsaOrder);
        case 'VARGAS':        return calcVargas(engine, birthDt, location, ayanamsaOrder);
        case 'ASHTAKAVARGA':  return calcAshtakavarga(engine, birthDt, location, ayanamsaOrder);
        case 'DASHA':         return calcDasha(engine, birthDt, location, ayanamsaOrder);
    }
}

// ---------------------------------------------------------------------------
// CLI shim — run directly: node calculate_chart.js '{"date":"1996-12-07",...}'
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const raw = process.argv[2];
    if (!raw) {
        console.error('Usage: node calculate_chart.js \'{"date":"YYYY-MM-DD","time":"HH:MM:SS","lat":0,"lon":0,"ayanamsa":"LAHIRI","calculation_type":"CORE_CHARTS"}\'');
        process.exit(1);
    }
    try {
        const result = await calculateChart(JSON.parse(raw));
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error({ error: err.message });
        process.exit(1);
    }
}
