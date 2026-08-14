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

/**
 * Each house, with a box that is guaranteed to sit inside its polygon.
 *
 * The twelve regions are three different shapes — four rhombi in the middle of
 * each edge, four wide triangles along the top and bottom, four tall ones up
 * the sides — and they are nothing like the same size. Laying content out from
 * the centroid with one set of offsets, which is what this did before, fits the
 * rhombi and pushes glyphs straight through the walls of the triangles.
 *
 * So every house declares its own usable box instead. Nothing is positioned
 * relative to a centroid any more; everything is positioned inside `w` x `h`
 * centred on `cx, cy`, and a box that fits the polygon means its contents do
 * too. The numbers are the largest axis-aligned rectangle that clears each
 * shape's diagonals, rounded down.
 */
interface House {
    house: number;
    points: string;
    cx: number; cy: number;
    /** Usable interior, centred on cx/cy. */
    w: number; h: number;
}

const HOUSES: ReadonlyArray<House> = [
    // Rhombi: |dx|/25 + |dy|/25 <= 1, so an inscribed rectangle needs
    // w + h <= 50. 24 x 24 sits just inside that.
    { house: 1,  points: HOUSE_1_POINTS,             cx: 50,   cy: 25,   w: 24, h: 24 },
    // Triangles: base 50 wide, apex 25 deep. At depth y the half-width is
    // 25 - y, so a box of height h resting on the base can only be
    // 2(25 - h) wide. Area peaks at h = 12.5, giving 25 x 12.5 — which is
    // why the old 28 x 13 poked through the diagonals at its far corners.
    { house: 2,  points: '0,0 50,0 25,25',           cx: 25,   cy: 6.5,  w: 24, h: 12 },
    { house: 3,  points: '0,0 25,25 0,50',           cx: 6.5,  cy: 25,   w: 12, h: 24 },
    { house: 4,  points: '0,50 25,25 50,50 25,75',   cx: 25,   cy: 50,   w: 24, h: 24 },
    { house: 5,  points: '0,50 25,75 0,100',         cx: 6.5,  cy: 75,   w: 12, h: 24 },
    { house: 6,  points: '0,100 25,75 50,100',       cx: 25,   cy: 93.5, w: 24, h: 12 },
    { house: 7,  points: '50,100 25,75 50,50 75,75', cx: 50,   cy: 75,   w: 24, h: 24 },
    { house: 8,  points: '50,100 75,75 100,100',     cx: 75,   cy: 93.5, w: 24, h: 12 },
    { house: 9,  points: '100,100 75,75 100,50',     cx: 93.5, cy: 75,   w: 12, h: 24 },
    { house: 10, points: '100,50 75,75 50,50 75,25', cx: 75,   cy: 50,   w: 24, h: 24 },
    { house: 11, points: '100,50 75,25 100,0',       cx: 93.5, cy: 25,   w: 12, h: 24 },
    { house: 12, points: '100,0 75,25 50,0',         cx: 75,   cy: 6.5,  w: 24, h: 12 },
];

/**
 * Fit `n` grahas inside a box.
 *
 * Returns the grid and the body radius that makes them fit, shrinking rather
 * than overflowing. A chart with a stellium is exactly when the diagram is most
 * worth reading, so the answer to "too many for the space" has to be smaller
 * planets, never planets outside the walls.
 *
 * A cell is 4.6r wide and 5.4r tall: the body is 2r across and the two-letter
 * code below it is roughly 1.4r tall, plus breathing room on each side.
 */
function fitGrahas(n: number, w: number, h: number) {
    const MAX_R = 2.8;
    // A hard floor. Below this the bodies stop being distinguishable and the
    // codes stop being readable, and a chart that is technically inside its
    // walls but illegible has solved the wrong problem.
    const MIN_R = 1.9;

    for (let r = MAX_R; r >= MIN_R; r -= 0.05) {
        // The code sits beside the body, not below it: 2r of body, a gap, and
        // two monospace characters. That makes a cell wide and short rather
        // than narrow and tall, which is the shape the crowded houses have.
        const cellW = r * 5.2;
        const cellH = r * 2.9;
        const cols = Math.max(1, Math.floor(w / cellW));
        const rows = Math.ceil(n / cols);
        if (rows * cellH <= h) return { r, cols, cellW, cellH };
    }

    // Nine grahas in one house is astronomically possible and visually
    // hopeless; at the floor size they are still inside the walls, which is
    // the property that matters.
    const r = MIN_R;
    const cellW = r * 5.2;
    return { r, cols: Math.max(1, Math.floor(w / cellW)), cellW, cellH: r * 2.9 };
}

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

export function ChartWheel({ ascendantSign, planets, size = 560 }: {
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
                style={{ width: '100%', maxWidth: size, height: 'auto', overflow: 'visible', direction: 'ltr' }}
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

                {HOUSES.map(({ house, cx, cy, w, h }, i) => {
                    // House 1 holds the ascendant; the rest follow the zodiac
                    // in order around the fixed frame.
                    const sign = rashi(ascendantSign + house - 1);
                    const here = byHouse.get(house) ?? [];
                    const delay = 0.42 + i * 0.028;

                    // The sign number is pinned to the top-left of the usable
                    // box, and the grahas get whatever is left below it. Both
                    // are inside the box, so both are inside the polygon.
                    const numberH = 5;
                    const fit = fitGrahas(Math.max(here.length, 1), w, h - numberH);
                    const rows = Math.ceil(here.length / fit.cols);
                    const gridTop = cy - h / 2 + numberH + (h - numberH - rows * fit.cellH) / 2;

                    return (
                        <m.g key={house}
                            variants={{
                                hidden: { opacity: 0 },
                                shown: { opacity: 1, transition: { delay, duration: mo.base } },
                            }}
                        >
                            <text
                                x={cx - w / 2} y={cy - h / 2 + 3.6}
                                textAnchor="start"
                                fill={brass.mid}
                                opacity={0.7}
                                style={{ fontSize: 3.6, fontFamily: fonts.mono }}
                            >
                                {sign.index}
                            </text>

                            {here.map((p, j) => {
                                const col = j % fit.cols;
                                const row = Math.floor(j / fit.cols);
                                const usedCols = Math.min(fit.cols, here.length - row * fit.cols);
                                // Centre each row's own cells, so a trailing row
                                // of one sits under the middle rather than hard
                                // against the left wall.
                                const rowW = usedCols * fit.cellW;
                                // The body sits left of its cell's centre by
                                // half the label's width: the pair is what has
                                // to be centred, and centring the body alone
                                // hangs the code off the right of every cell —
                                // which at the right-hand houses means off the
                                // chart.
                                const cellMid = cx - rowW / 2 + fit.cellW * (col + 0.5);
                                const x = cellMid - fit.r * 1.15;
                                const y = gridTop + fit.cellH * row + fit.r * 1.45;

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
                                            r={fit.r}
                                            retrograde={p.retrograde}
                                            labelSide="right"
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
