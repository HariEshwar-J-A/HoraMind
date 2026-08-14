import { motion as m } from 'motion/react';
import { brass, fonts, motion as mo, space } from '../../theme/tokens.js';
import { rashi } from './zodiac.js';
import { PlanetBody } from './PlanetBody.js';

/**
 * The North Indian kundli.
 *
 * The recognisable form: a fixed square of twelve houses, drawn by two
 * diagonals and a diamond joining the edge midpoints. What moves between charts
 * is not the geometry but the *signs* — house 1 is always the top-centre
 * diamond, and it carries whichever rashi was rising.
 *
 * Every element here — `svg`, `g`, `path`, `line`, `text`, `circle` — has a
 * `react-native-svg` equivalent taking the same props, which is the constraint
 * `screens/Chart.tsx` asked for so the geometry survives a native port. The
 * only web-only thing is `motion`, and it lives in `components/` where the DOM
 * is allowed.
 *
 * The whole diagram is laid out in a 100×100 user-space box and scaled by the
 * viewBox, so a single set of coordinates serves every screen size and no
 * measurement of the viewport is ever needed.
 */

/**
 * House 1 — the top-centre diamond, named because both the house list and the
 * ascendant highlight need it and `HOUSES[0]` is the kind of index that goes
 * stale silently if the list is ever reordered.
 */
const HOUSE_1_POINTS = '50,0 75,25 50,50 25,25';

/** Corner of the outer square, edge midpoint, and centre. */
const HOUSES: ReadonlyArray<{ house: number; points: string; cx: number; cy: number }> = [
    { house: 1,  points: HOUSE_1_POINTS,              cx: 50,   cy: 26 },
    { house: 2,  points: '0,0 50,0 25,25',            cx: 25,   cy: 11 },
    { house: 3,  points: '0,0 25,25 0,50',            cx: 11,   cy: 25 },
    { house: 4,  points: '0,50 25,25 50,50 25,75',    cx: 25,   cy: 51 },
    { house: 5,  points: '0,50 25,75 0,100',          cx: 11,   cy: 75 },
    { house: 6,  points: '0,100 25,75 50,100',        cx: 25,   cy: 89 },
    { house: 7,  points: '50,100 25,75 50,50 75,75',  cx: 50,   cy: 76 },
    { house: 8,  points: '50,100 75,75 100,100',      cx: 75,   cy: 89 },
    { house: 9,  points: '100,100 75,75 100,50',      cx: 89,   cy: 75 },
    { house: 10, points: '100,50 75,75 50,50 75,25',  cx: 75,   cy: 51 },
    { house: 11, points: '100,50 75,25 100,0',        cx: 89,   cy: 25 },
    { house: 12, points: '100,0 75,25 50,0',          cx: 75,   cy: 11 },
];

/** The five strokes that make the frame, drawn in this order. */
const FRAME: ReadonlyArray<string> = [
    'M0,0 H100 V100 H0 Z',   // outer square
    'M50,0 L100,50 L50,100 L0,50 Z', // inner diamond
    'M0,0 L100,100',         // diagonal
    'M100,0 L0,100',         // diagonal
];

export interface WheelPlanet {
    name: string;
    house: number;
    signName: string;
    degree: number;
    retrograde: boolean;
}

export function ChartWheel({ ascendantSign, planets, size = 400 }: {
    /** 1–12, the rashi occupying house 1. */
    ascendantSign: number;
    planets: readonly WheelPlanet[];
    size?: number;
}) {
    const byHouse = new Map<number, WheelPlanet[]>();
    for (const p of planets) {
        const list = byHouse.get(p.house) ?? [];
        list.push(p);
        byHouse.set(p.house, list);
    }

    return (
        <div style={{
            display: 'flex', justifyContent: 'center',
            marginBottom: space.lg, marginTop: space.xs,
        }}>
            <m.svg
                viewBox="-6 -6 112 112"
                width={size}
                height={size}
                role="img"
                aria-label={`North Indian chart, ${rashi(ascendantSign).english} ascendant`}
                initial="hidden"
                animate="shown"
                style={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }}
            >
                <defs>
                    {/* Gold leaf: brighter at the top-left, as if lit from there. */}
                    <linearGradient id="hm-brass" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={brass.light} />
                        <stop offset="55%" stopColor={brass.mid} />
                        <stop offset="100%" stopColor={brass.deep} />
                    </linearGradient>
                    <radialGradient id="hm-asc-glow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={brass.glow} />
                        <stop offset="100%" stopColor="rgba(201,162,39,0)" />
                    </radialGradient>
                </defs>

                {/* Ascendant house, lit from beneath the engraving. */}
                <m.polygon
                    points={HOUSE_1_POINTS}
                    fill="url(#hm-asc-glow)"
                    variants={{
                        hidden: { opacity: 0 },
                        shown: { opacity: [0, 0.9, 0.55], transition: { duration: 1.6, delay: 0.35, times: [0, 0.4, 1] } },
                    }}
                />

                {/* The frame draws itself, stroke by stroke. */}
                {FRAME.map((d, i) => (
                    <m.path
                        key={d}
                        d={d}
                        fill="none"
                        stroke="url(#hm-brass)"
                        strokeWidth={i < 2 ? 0.7 : 0.4}
                        strokeLinejoin="round"
                        variants={{
                            hidden: { pathLength: 0, opacity: 0 },
                            shown: {
                                pathLength: 1,
                                opacity: i < 2 ? 0.95 : 0.5,
                                transition: { duration: 0.62, delay: i * 0.08, ease: mo.standard },
                            },
                        }}
                    />
                ))}

                {HOUSES.map(({ house, cx, cy }, i) => {
                    // House 1 holds the ascendant; the rest follow the zodiac
                    // in order around the fixed frame.
                    const sign = rashi(ascendantSign + house - 1);
                    const here = byHouse.get(house) ?? [];
                    const delay = 0.42 + i * 0.028;

                    return (
                        <m.g key={house}
                            variants={{
                                hidden: { opacity: 0 },
                                shown: { opacity: 1, transition: { delay, duration: mo.base } },
                            }}
                        >
                            {/* Sign number, engraved small and out of the way. */}
                            <text
                                x={cx} y={cy - 8}
                                textAnchor="middle"
                                fill={brass.mid}
                                opacity={0.75}
                                style={{ fontSize: 4.2, fontFamily: fonts.mono, letterSpacing: 0.2 }}
                            >
                                {sign.index}
                            </text>

                            {here.map((p, j) => {
                                // Stack downwards from the centroid so a house
                                // with four grahas stays inside its own region.
                                // Four grahas in one house is common (a stellium
                                // in Cancer here) and a single column runs off the
                                // edge of the diagram. Past two, split into two
                                // columns and tighten the rows.
                                const twoCol = here.length > 2;
                                const rows = twoCol ? Math.ceil(here.length / 2) : here.length;
                                const col = twoCol ? j % 2 : 0;
                                const row = twoCol ? Math.floor(j / 2) : j;
                                const x = cx + (twoCol ? (col === 0 ? -5.5 : 5.5) : 0);
                                const y = cy + row * 8.4 - (rows - 1) * 3.6;
                                return (
                                    <m.g key={p.name}
                                        variants={{
                                            hidden: { opacity: 0, scale: 0.4 },
                                            shown: {
                                                opacity: 1, scale: 1,
                                                transition: {
                                                    delay: delay + 0.16 + j * 0.05,
                                                    duration: mo.base, ease: mo.standard,
                                                },
                                            },
                                        }}
                                        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                                    >
                                        <PlanetBody
                                            name={p.name}
                                            cx={x} cy={y}
                                            r={2.2}
                                            retrograde={p.retrograde}
                                        />
                                    </m.g>
                                );
                            })}
                        </m.g>
                    );
                })}

                {/* "Asc" sits on the outer edge of house 1 rather than inside
                    it, which is already the busiest region on the chart. */}
                <m.text
                    x={50} y={-1.6}
                    textAnchor="middle"
                    fill={brass.light}
                    style={{ fontSize: 3.2, fontFamily: fonts.mono, letterSpacing: 0.6 }}
                    variants={{
                        hidden: { opacity: 0, y: -4 },
                        shown: { opacity: 0.9, y: 0, transition: { delay: 0.95, duration: mo.base } },
                    }}
                >
                    ASC
                </m.text>
            </m.svg>
        </div>
    );
}
