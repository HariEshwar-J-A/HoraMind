import { motion as m, useReducedMotion } from 'motion/react';
import { brass, colors, fonts, motion as mo, space } from '../../theme/tokens.js';
import { NAKSHATRA_ARC, nakshatraAt } from './zodiac.js';

/**
 * The 27 nakshatras as a dial, with the Moon on it.
 *
 * The Moon's nakshatra is the single most consequential fact in a Vedic chart —
 * it fixes the Vimshottari dasha sequence, so the whole timeline of a life
 * hangs off which 13°20' arc it fell in. A row of text saying "Rohini" states
 * that; a dial shows it as a position, with the neighbouring arcs it did not
 * fall into visible on either side.
 *
 * Drawn with `path`, `circle` and `text` only, so `react-native-svg` renders it
 * unchanged.
 */

const R_OUTER = 46;
const R_INNER = 36;
const CENTRE = 50;

/** Polar to cartesian, with 0° at the top and angles running clockwise. */
function point(angleDeg: number, radius: number): [number, number] {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [CENTRE + radius * Math.cos(rad), CENTRE + radius * Math.sin(rad)];
}

/** One nakshatra arc as a closed wedge between the two radii. */
function wedge(startDeg: number, endDeg: number): string {
    const [x1, y1] = point(startDeg, R_OUTER);
    const [x2, y2] = point(endDeg, R_OUTER);
    const [x3, y3] = point(endDeg, R_INNER);
    const [x4, y4] = point(startDeg, R_INNER);
    // Every wedge is 13.33°, so the large-arc flag is always 0.
    return `M${x1},${y1} A${R_OUTER},${R_OUTER} 0 0 1 ${x2},${y2} `
        + `L${x3},${y3} A${R_INNER},${R_INNER} 0 0 0 ${x4},${y4} Z`;
}

export function NakshatraDial({ moonLongitude, size = 210 }: {
    /** Sidereal longitude of the Moon, degrees from 0° Aries. */
    moonLongitude: number;
    size?: number;
}) {
    const still = useReducedMotion();
    const { index, name, pada } = nakshatraAt(moonLongitude);
    const moonAngle = ((moonLongitude % 360) + 360) % 360;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.sm }}>
            <svg
                viewBox="0 0 100 100" width={size} height={size}
                role="img"
                aria-label={`Moon in ${name}, pada ${pada}`}
                style={{ maxWidth: '100%', height: 'auto' }}
            >
                {Array.from({ length: 27 }, (_, i) => {
                    const occupied = i === index;
                    return (
                        <m.path
                            key={i}
                            d={wedge(i * NAKSHATRA_ARC + 0.45, (i + 1) * NAKSHATRA_ARC - 0.45)}
                            fill={occupied ? brass.mid : colors.surfaceRaised}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: occupied ? 0.95 : 0.5 }}
                            transition={{
                                duration: mo.base,
                                // Sweep round the dial rather than appearing at
                                // once, so the ring reads as 27 divisions.
                                delay: still ? 0 : i * 0.022,
                            }}
                        />
                    );
                })}

                {/* The Moon, placed on its own arc.
                    Positioned from the computed point rather than by rotating a
                    group: `transformOrigin` on an SVG `<g>` is measured in CSS
                    pixels of the rendered box, not in the 100-unit user space
                    this diagram is drawn in, so the pivot lands somewhere
                    unrelated to the centre and the marker stays at twelve
                    o'clock. Trigonometry has no such ambiguity. */}
                <m.g
                    initial={{ opacity: 0, scale: still ? 1 : 0.3 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: still ? 0.01 : mo.base, delay: still ? 0 : 0.75, ease: mo.standard }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                    {(() => {
                        const [mx, my] = point(moonAngle, (R_OUTER + R_INNER) / 2);
                        return (
                            <>
                                <circle cx={mx} cy={my} r={3.8} fill={colors.background} />
                                <circle
                                    cx={mx} cy={my} r={2.6}
                                    fill="#EEF0F7" stroke={brass.light} strokeWidth={0.6}
                                />
                            </>
                        );
                    })()}
                </m.g>

                <text
                    x={CENTRE} y={CENTRE - 2}
                    textAnchor="middle"
                    fill={colors.text}
                    style={{ fontSize: 8, fontFamily: fonts.display }}
                >
                    {name}
                </text>
                <text
                    x={CENTRE} y={CENTRE + 7}
                    textAnchor="middle"
                    fill={colors.textFaint}
                    style={{ fontSize: 4.6, fontFamily: fonts.mono, letterSpacing: 0.4 }}
                >
                    PADA {pada}
                </text>
            </svg>
        </div>
    );
}
