import { motion as m, useReducedMotion } from 'motion/react';
import { brass, colors, fonts, motion as mo, space } from '../../theme/tokens.js';
import { NAKSHATRA_ARC, nakshatraAt } from './zodiac.js';

/**
 * The 27 nakshatras as a turning dial, with the Moon on it.
 *
 * The Moon's nakshatra is the single most consequential fact in a Vedic chart —
 * it fixes the Vimshottari sequence, so the whole timeline of a life hangs off
 * which 13°20' arc it fell in. A row of text states that; this shows it as a
 * position, with the arcs it did not fall into visible on either side.
 *
 * Built as three counter-rotating rings. The counter-rotation is the point:
 * two rings turning the same way read as one object spinning, which is a
 * loading spinner. Turning against each other reads as an instrument — an
 * astrolabe, which is exactly what this is a diagram of.
 *
 * Everything is `path`, `circle`, `line` and `text`, so `react-native-svg`
 * renders it unchanged.
 */

const R_STAR = 48;    // outermost: drifting stars
const R_OUTER = 43;
const R_INNER = 33;
const R_GLYPH = 27;   // inner tick ring
const CENTRE = 50;

function point(angleDeg: number, radius: number): [number, number] {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [CENTRE + radius * Math.cos(rad), CENTRE + radius * Math.sin(rad)];
}

function wedge(startDeg: number, endDeg: number): string {
    const [x1, y1] = point(startDeg, R_OUTER);
    const [x2, y2] = point(endDeg, R_OUTER);
    const [x3, y3] = point(endDeg, R_INNER);
    const [x4, y4] = point(startDeg, R_INNER);
    return `M${x1},${y1} A${R_OUTER},${R_OUTER} 0 0 1 ${x2},${y2} `
        + `L${x3},${y3} A${R_INNER},${R_INNER} 0 0 0 ${x4},${y4} Z`;
}

/** Fixed stars on the outer ring. Seeded so the sky never reshuffles. */
const STARS = Array.from({ length: 34 }, (_, i) => {
    const a = (i * 137.508) % 360;          // golden angle: even without a lattice
    const jitter = ((i * 2654435761) % 1000) / 1000;
    return { angle: a, r: R_STAR + jitter * 4 - 2, size: 0.28 + jitter * 0.5 };
});

export function NakshatraDial({ moonLongitude, size = 250 }: {
    moonLongitude: number;
    size?: number;
}) {
    const still = useReducedMotion();
    const { index, name, pada } = nakshatraAt(moonLongitude);
    const moonAngle = ((moonLongitude % 360) + 360) % 360;
    const [mx, my] = point(moonAngle, (R_OUTER + R_INNER) / 2);

    const spin = (duration: number, reverse = false) => still ? undefined : {
        animate: { rotate: reverse ? -360 : 360 },
        transition: { duration, repeat: Infinity, ease: 'linear' as const },
        style: { transformOrigin: `${CENTRE}px ${CENTRE}px` },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.sm }}>
            <svg
                viewBox="0 0 100 100" width={size} height={size}
                role="img"
                aria-label={`Moon in ${name}, pada ${pada}`}
                style={{ maxWidth: '100%', height: 'auto', overflow: 'visible' }}
            >
                <defs>
                    <radialGradient id="hm-dial-core" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(201,162,39,0.20)" />
                        <stop offset="70%" stopColor="rgba(201,162,39,0.04)" />
                        <stop offset="100%" stopColor="rgba(11,13,23,0)" />
                    </radialGradient>
                    <radialGradient id="hm-moon-halo" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(238,240,247,0.55)" />
                        <stop offset="100%" stopColor="rgba(238,240,247,0)" />
                    </radialGradient>
                    <linearGradient id="hm-dial-live" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={brass.light} />
                        <stop offset="100%" stopColor={brass.deep} />
                    </linearGradient>
                </defs>

                <circle cx={CENTRE} cy={CENTRE} r={R_INNER} fill="url(#hm-dial-core)" />

                {/* Outermost: a slow drift of stars, one way. */}
                <m.g {...spin(150)}>
                    {STARS.map((s, i) => {
                        const [x, y] = point(s.angle, s.r);
                        return (
                            <m.circle
                                key={i} cx={x} cy={y} r={s.size}
                                fill={i % 7 === 0 ? brass.light : '#DCE3FF'}
                                animate={still ? undefined : { opacity: [0.25, 0.85, 0.25] }}
                                transition={still ? undefined : {
                                    duration: 3 + (i % 5), repeat: Infinity,
                                    delay: i * 0.17, ease: 'easeInOut',
                                }}
                            />
                        );
                    })}
                </m.g>

                {/* The 27 arcs. Static, because this is the ring being measured
                    against — a scale that moved would measure nothing. */}
                <g>
                    {Array.from({ length: 27 }, (_, i) => {
                        const live = i === index;
                        return (
                            <m.path
                                key={i}
                                d={wedge(i * NAKSHATRA_ARC + 0.5, (i + 1) * NAKSHATRA_ARC - 0.5)}
                                fill={live ? 'url(#hm-dial-live)' : colors.surfaceRaised}
                                initial={{ opacity: 0 }}
                                animate={
                                    live && !still
                                        ? { opacity: [0.75, 1, 0.75] }
                                        : { opacity: live ? 0.95 : 0.45 }
                                }
                                transition={
                                    live && !still
                                        ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 1 }
                                        : { duration: mo.base, delay: still ? 0 : i * 0.02 }
                                }
                            />
                        );
                    })}
                </g>

                {/* Inner tick ring, turning the other way. */}
                <m.g {...spin(90, true)} opacity={0.5}>
                    {Array.from({ length: 27 }, (_, i) => {
                        const [x1, y1] = point(i * NAKSHATRA_ARC, R_GLYPH);
                        const [x2, y2] = point(i * NAKSHATRA_ARC, R_GLYPH - 2.4);
                        return (
                            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                                stroke={i % 9 === 0 ? brass.mid : colors.border}
                                strokeWidth={i % 9 === 0 ? 0.5 : 0.28} />
                        );
                    })}
                </m.g>

                {/* A line from the centre out to the Moon: the reading itself,
                    drawn as the instrument would draw it. */}
                <m.line
                    x1={CENTRE} y1={CENTRE} x2={mx} y2={my}
                    stroke={brass.mid} strokeWidth={0.35} opacity={0.5}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: still ? 0.01 : 1.1, delay: 0.6, ease: mo.standard }}
                />

                {/* The Moon, with a halo that breathes. */}
                <m.g
                    initial={{ opacity: 0, scale: still ? 1 : 0.2 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: still ? 0.01 : 0.7, delay: still ? 0 : 0.9, ease: mo.standard }}
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                    <m.circle
                        cx={mx} cy={my} r={7} fill="url(#hm-moon-halo)"
                        animate={still ? undefined : { opacity: [0.45, 0.9, 0.45], r: [6, 8.5, 6] }}
                        transition={still ? undefined : { duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <circle cx={mx} cy={my} r={3.1} fill="#0B0D17" />
                    <circle cx={mx} cy={my} r={2.4} fill="#F2F4FF" stroke={brass.light} strokeWidth={0.45} />
                    {/* A crescent bite, so it reads as the Moon and not a dot. */}
                    <circle cx={mx + 1.05} cy={my - 0.85} r={1.9} fill="#0B0D17" opacity={0.55} />
                </m.g>

                <text
                    x={CENTRE} y={CENTRE - 1}
                    textAnchor="middle" fill={colors.text}
                    style={{ fontSize: 7.6, fontFamily: fonts.display }}
                >
                    {name}
                </text>
                <text
                    x={CENTRE} y={CENTRE + 7}
                    textAnchor="middle" fill={brass.mid}
                    style={{ fontSize: 4.2, fontFamily: fonts.mono, letterSpacing: 0.5 }}
                >
                    PADA {pada}
                </text>
            </svg>
        </div>
    );
}
