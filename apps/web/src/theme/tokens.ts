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
