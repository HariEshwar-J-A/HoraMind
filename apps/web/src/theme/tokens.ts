/**
 * Design tokens.
 *
 * Plain objects, not CSS strings and not Tailwind classes. This is the single
 * decision that makes a later React Native port mechanical rather than a
 * rewrite: `{ padding: 16, backgroundColor: '#0B0D17' }` is valid in both a DOM
 * `style` prop and a React Native `StyleSheet`, while `class="p-4 bg-slate-900"`
 * is valid in neither once you leave the web.
 *
 * Numbers are unitless for the same reason. The web adapter appends `px`;
 * React Native takes density-independent pixels directly.
 */

export const colors = {
    // Night sky. The subject matter is nocturnal and most use is in the evening.
    background: '#0B0D17',
    surface: '#151827',
    surfaceRaised: '#1E2235',
    border: '#2A2F45',

    text: '#EEF0F7',
    textMuted: '#9AA0B8',
    textFaint: '#6B7192',

    accent: '#C9A227',        // muted gold
    accentSoft: '#3A3316',

    benefic: '#5BC98C',
    malefic: '#E2725B',
    neutral: '#7B8CDE',

    danger: '#E2545B',
    overlay: 'rgba(11, 13, 23, 0.72)',
} as const;

/**
 * Astronomical-instrument accents.
 *
 * The palette above is a night sky; these are the brass laid on it. The
 * reference is an astrolabe rather than a dashboard: engraved hairlines, gold
 * leaf catching light at one edge, and nothing that glows for its own sake.
 * Three golds rather than one because a single flat accent reads as printed,
 * and an instrument reads as *made*.
 */
export const brass = {
    light: '#E8CE7A',
    mid: '#C9A227',
    deep: '#8A6D18',
    /** Engraved lines on the chart: visible, never competing with the glyphs. */
    engrave: '#3A4160',
    engraveFaint: '#232941',
    glow: 'rgba(201, 162, 39, 0.35)',
} as const;

/**
 * Motion.
 *
 * Durations and easings as plain data so a React Native port feeds the same
 * numbers to Reanimated. The long `slow` is for orbital movement, where the
 * whole point is that a planet takes visible time to travel to its house.
 *
 * `standard` is a gentle overshoot — things arriving in an orbit settle rather
 * than stop dead. `exit` is deliberately faster than `enter`: a screen leaving
 * should get out of the way, and matching the two makes navigation feel sticky.
 */
export const motion = {
    fast: 0.18,
    base: 0.32,
    slow: 0.9,
    orbital: 1.4,
    /** cubic-bezier control points, valid for both Motion and Reanimated. */
    standard: [0.22, 1, 0.36, 1],
    exit: [0.4, 0, 1, 1],
    /** Seconds between siblings in a staggered reveal. */
    stagger: 0.055,
} as const;

/**
 * Type families.
 *
 * A serif for anything that names a celestial body. It is doing real work: the
 * subject is a 1500-year-old text tradition, and a geometric sans makes a
 * nakshatra look like a SaaS metric. Both stacks are system-resident on Apple
 * and Android, so nothing is fetched — which matters for a PWA that is supposed
 * to open offline, and a webfont would be the one asset the service worker
 * could not guarantee.
 */
export const fonts = {
    display: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    /** Tabular figures keep degree columns from shifting as values change. */
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
} as const;

/** A 4-point scale. Everything spatial is a multiple, so nothing is arbitrary. */
export const space = {
    xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
    display: { fontSize: 28, fontWeight: '600', lineHeight: 34 },
    title:   { fontSize: 20, fontWeight: '600', lineHeight: 26 },
    body:    { fontSize: 16, fontWeight: '400', lineHeight: 24 },
    small:   { fontSize: 14, fontWeight: '400', lineHeight: 20 },
    caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
} as const;

/**
 * Minimum touch target.
 *
 * 44 is Apple's guidance and Android's is 48dp; the larger is used because
 * being generous costs nothing and the app is mobile-first.
 */
export const touchTarget = 48;

export type Style = Record<string, string | number>;

/**
 * Convert a token style object to something the DOM accepts.
 *
 * The only web-specific function in the theme. React Native consumes the same
 * objects with no conversion at all — which is the point of keeping the numbers
 * unitless in the first place.
 */
export function toWebStyle(style: Style): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(style)) {
        out[key] = typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : value;
    }
    return out;
}

/**
 * Properties that are bare numbers in both worlds and must not gain `px`.
 *
 * `lineHeight` is deliberately absent. React Native treats it as pixels, which
 * is how the tokens above are written, but CSS treats a bare number as a
 * *multiplier* — so passing 34 through unitless would render a line box 34
 * times the font size instead of 34 pixels tall.
 */
const UNITLESS = new Set([
    'flex', 'flexGrow', 'flexShrink', 'opacity', 'zIndex', 'fontWeight',
    'order', 'aspectRatio',
]);
