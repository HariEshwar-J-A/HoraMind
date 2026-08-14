import { motion as m } from 'motion/react';
import { fonts } from '../../theme/tokens.js';

/**
 * A graha drawn as a body, with its two-letter code beneath.
 *
 * Rendered rather than fetched. "High definition" for a chart that scales from
 * a phone to a desktop means resolution-independent, not large: an SVG sphere
 * is exact at every DPI, weighs nothing, needs no network on a PWA that is
 * meant to open offline, and carries no image licence. A bitmap would be soft
 * on one of those screens and stale on all of them.
 *
 * Each body is shaded by a radial gradient offset up and left, so every planet
 * in a chart is lit from the same direction and the set reads as one system
 * rather than nine stickers.
 *
 * The two-letter codes are the standard abbreviations — Su, Mo, Ma, Me, Ju, Ve,
 * Sa, Ra, Ke — and they are the reason this component exists. A glyph like ☿ is
 * unreadable at 6px and unknown to most people; two letters are legible at any
 * size and need no key.
 */

interface Body {
    code: string;
    /** Lit face, body colour, shadow. Ordered light to dark. */
    palette: [string, string, string];
    ring?: boolean;
    corona?: boolean;
    /** A shadow body: drawn as an eclipse rather than a lit sphere. */
    shadow?: boolean;
}

const BODIES: Record<string, Body> = {
    Sun:     { code: 'Su', palette: ['#FFE9A8', '#F2B03C', '#9A5A08'], corona: true },
    Moon:    { code: 'Mo', palette: ['#FFFFFF', '#D8DCEA', '#7C8299'] },
    Mars:    { code: 'Ma', palette: ['#FFB08A', '#D9532F', '#6E2312'] },
    Mercury: { code: 'Me', palette: ['#DCE2F0', '#9AA3B8', '#4A5064'] },
    Jupiter: { code: 'Ju', palette: ['#FFE2B0', '#D9A05B', '#7A4E1E'] },
    Venus:   { code: 'Ve', palette: ['#FFF3D0', '#E8C36A', '#8A6B22'] },
    Saturn:  { code: 'Sa', palette: ['#F0E4C0', '#C2A768', '#6B5722'], ring: true },
    Rahu:    { code: 'Ra', palette: ['#6E7BA8', '#2C3350', '#0A0D18'], shadow: true },
    Ketu:    { code: 'Ke', palette: ['#8A7BA8', '#3A2C50', '#100A18'], shadow: true },
};

export function bodyCode(name: string): string {
    return BODIES[name]?.code ?? name.slice(0, 2);
}

/**
 * One graha at `(cx, cy)` in the parent SVG's user space.
 *
 * Takes no `size` in pixels — `r` is in the diagram's own units, so the same
 * component serves a 400px chart and a 40px inline chip without a second
 * scale to keep in sync.
 */
export function PlanetBody({ name, cx, cy, r = 4, retrograde = false, label = true, spin = true }: {
    name: string;
    cx: number;
    cy: number;
    r?: number;
    retrograde?: boolean;
    label?: boolean;
    /** The slow axial turn. Off for static contexts like a legend. */
    spin?: boolean;
}) {
    const body = BODIES[name] ?? { code: name.slice(0, 2), palette: ['#DDD', '#999', '#555'] as [string, string, string] };
    const [lit, mid, dark] = body.palette;
    const id = `pb-${name}-${Math.round(cx * 10)}-${Math.round(cy * 10)}`;

    return (
        <g>
            <defs>
                <radialGradient id={id} cx="35%" cy="30%" r="75%">
                    <stop offset="0%" stopColor={lit} />
                    <stop offset="55%" stopColor={mid} />
                    <stop offset="100%" stopColor={dark} />
                </radialGradient>
            </defs>

            {/* The Sun's corona: a soft ring that breathes, so the one body
                that emits light is the one that visibly does. */}
            {body.corona && (
                <m.circle
                    cx={cx} cy={cy} r={r * 1.7}
                    fill="none" stroke={lit} strokeWidth={r * 0.18}
                    animate={{ opacity: [0.16, 0.42, 0.16], r: [r * 1.55, r * 1.85, r * 1.55] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            {/* Saturn's ring, tilted. Drawn behind the sphere's lower half by
                being painted first, which is enough to read as "around". */}
            {body.ring && (
                <ellipse
                    cx={cx} cy={cy} rx={r * 1.85} ry={r * 0.6}
                    fill="none" stroke={lit} strokeWidth={r * 0.16}
                    opacity={0.85}
                    transform={`rotate(-18 ${cx} ${cy})`}
                />
            )}

            <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />

            {/* Rahu and Ketu have no disc of their own — they are the points
                where eclipses happen. Drawn as a bitten circle rather than a
                lit one, which is the whole of what they are. */}
            {body.shadow && (
                <circle
                    cx={cx + r * 0.42} cy={cy - r * 0.34} r={r * 0.82}
                    fill="#0B0D17" opacity={0.92}
                />
            )}

            {/* A specular highlight sells the sphere more than any amount of
                gradient does. */}
            {!body.shadow && (
                <ellipse
                    cx={cx - r * 0.32} cy={cy - r * 0.36}
                    rx={r * 0.3} ry={r * 0.22}
                    fill="#fff" opacity={0.5}
                    transform={`rotate(-25 ${cx - r * 0.32} ${cy - r * 0.36})`}
                />
            )}

            {/* The slow turn. Applied to a thin terminator arc rather than the
                whole body, because rotating a radial gradient just wobbles the
                highlight and reads as a wobble, not a rotation. */}
            {spin && !body.shadow && (
                <m.ellipse
                    cx={cx} cy={cy} rx={r * 0.34} ry={r * 0.94}
                    fill={dark} opacity={0.16}
                    animate={{ rx: [r * 0.1, r * 0.5, r * 0.1] }}
                    transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            {label && (
                <text
                    x={cx} y={cy + r * 2.55}
                    textAnchor="middle"
                    fill={lit}
                    style={{
                        fontSize: r * 1.35,
                        fontFamily: fonts.mono,
                        letterSpacing: r * 0.04,
                        fontWeight: 600,
                    }}
                >
                    {body.code}
                    {retrograde && (
                        <tspan fill="#E2725B" style={{ fontSize: r * 0.95 }}>℞</tspan>
                    )}
                </text>
            )}
        </g>
    );
}
