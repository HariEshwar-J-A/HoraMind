import { motion as m } from 'motion/react';
import { brass, fonts, motion as mo, space } from '../../theme/tokens.js';
import { rashi } from './zodiac.js';
import { PlanetBody } from './PlanetBody.js';
import type { WheelPlanet } from './ChartWheel.js';

/**
 * The South Indian chart.
 *
 * The inverse convention to the North Indian square, and the difference is not
 * cosmetic. Here the *signs* are fixed to cells — Aries is always the second
 * cell of the top row, and every chart ever drawn puts it there — while the
 * ascendant moves, marked by a diagonal in whichever cell holds it. In the
 * North Indian chart the houses are fixed and the signs rotate.
 *
 * So a reader of one can find a planet by looking at a remembered position, and
 * a reader of the other cannot. That is the whole reason both exist and why
 * this is a real second component rather than a restyle of the first.
 *
 * A 4x4 grid with the middle four cells empty; the twelve signs run clockwise
 * around the ring starting from Pisces at the top-left.
 */

/** Clockwise from the top-left cell. The order is the convention, not a choice. */
const CELLS: ReadonlyArray<{ sign: number; col: number; row: number }> = [
    { sign: 12, col: 0, row: 0 }, { sign: 1,  col: 1, row: 0 },
    { sign: 2,  col: 2, row: 0 }, { sign: 3,  col: 3, row: 0 },
    { sign: 11, col: 0, row: 1 }, { sign: 4,  col: 3, row: 1 },
    { sign: 10, col: 0, row: 2 }, { sign: 5,  col: 3, row: 2 },
    { sign: 9,  col: 0, row: 3 }, { sign: 8,  col: 1, row: 3 },
    { sign: 7,  col: 2, row: 3 }, { sign: 6,  col: 3, row: 3 },
];

const SIDE = 25;

export function SouthChart({ ascendantSign, planets, size = 400 }: {
    ascendantSign: number;
    planets: readonly WheelPlanet[];
    size?: number;
}) {
    // Planets arrive with a house number; the sign is house counted from the
    // ascendant, which is what places them on a fixed-sign grid.
    const bySign = new Map<number, WheelPlanet[]>();
    for (const p of planets) {
        const sign = ((ascendantSign - 1 + p.house - 1) % 12) + 1;
        const list = bySign.get(sign) ?? [];
        list.push(p);
        bySign.set(sign, list);
    }

    return (
        <div style={{
            display: 'flex', justifyContent: 'center',
            marginBottom: space.lg, marginTop: space.xs,
        }}>
            <m.svg
                viewBox="-4 -4 108 108"
                width={size} height={size}
                role="img"
                aria-label={`South Indian chart, ${rashi(ascendantSign).english} ascendant`}
                initial="hidden" animate="shown"
                style={{ maxWidth: '100%', height: 'auto' }}
            >
                <defs>
                    <linearGradient id="hm-brass-s" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={brass.light} />
                        <stop offset="55%" stopColor={brass.mid} />
                        <stop offset="100%" stopColor={brass.deep} />
                    </linearGradient>
                </defs>

                {CELLS.map(({ sign, col, row }, i) => {
                    const x = col * SIDE;
                    const y = row * SIDE;
                    const here = bySign.get(sign) ?? [];
                    const isAsc = sign === ascendantSign;
                    const delay = 0.3 + i * 0.03;

                    return (
                        <m.g key={sign}
                            variants={{
                                hidden: { opacity: 0 },
                                shown: { opacity: 1, transition: { delay, duration: mo.base } },
                            }}
                        >
                            <rect
                                x={x} y={y} width={SIDE} height={SIDE}
                                fill={isAsc ? 'rgba(201,162,39,0.10)' : 'transparent'}
                                stroke="url(#hm-brass-s)"
                                strokeWidth={0.5}
                            />

                            {/* The ascendant is marked by a diagonal across its
                                own cell — the classical notation, and the only
                                thing that distinguishes one South chart from
                                another at a glance. */}
                            {isAsc && (
                                <line
                                    x1={x} y1={y} x2={x + SIDE / 2.2} y2={y + SIDE / 2.2}
                                    stroke={brass.light} strokeWidth={0.8}
                                />
                            )}

                            <text
                                x={x + SIDE - 1.6} y={y + 4.4}
                                textAnchor="end"
                                fill={brass.mid} opacity={0.7}
                                style={{ fontSize: 3.4, fontFamily: fonts.mono }}
                            >
                                {rashi(sign).glyph}
                            </text>

                            {here.map((p, j) => {
                                const gx = x + 6 + (j % 2) * 12;
                                const gy = y + 10 + Math.floor(j / 2) * 9;
                                return (
                                    <m.g key={p.name}
                                        variants={{
                                            hidden: { opacity: 0, scale: 0.4 },
                                            shown: {
                                                opacity: 1, scale: 1,
                                                transition: { delay: delay + 0.15 + j * 0.05, duration: mo.base },
                                            },
                                        }}
                                        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                                    >
                                        <PlanetBody
                                            name={p.name}
                                            cx={gx} cy={gy}
                                            r={2.3}
                                            retrograde={p.retrograde}
                                        />
                                    </m.g>
                                );
                            })}
                        </m.g>
                    );
                })}
            </m.svg>
        </div>
    );
}
