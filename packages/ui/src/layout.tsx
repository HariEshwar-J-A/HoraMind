import type { CSSProperties, ReactNode } from 'react';
import { antara } from './tokens.js';

/**
 * Layout primitives.
 *
 * Sized against real pages, not in a vacuum. Components that look right in
 * isolation get resized the first time they meet a screen; these exist so
 * that meeting happens against a rhythm that is already decided.
 */

export function Stack({
    children, gap = 12, align, style,
}: {
    children: ReactNode;
    gap?: number;
    align?: 'start' | 'center' | 'stretch';
    style?: CSSProperties;
}) {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap,
            alignItems: align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'stretch',
            ...style,
        }}>
            {children}
        </div>
    );
}

/**
 * Horizontal row. Children get `min-width: 0` by default.
 *
 * A flex item's default `min-width: auto` refuses to shrink below its content,
 * which is why truncation inside a row silently does nothing and the row
 * overflows instead.
 */
export function Row({
    children, gap = 12, align = 'center', wrap = false, style,
}: {
    children: ReactNode;
    gap?: number;
    align?: 'start' | 'center' | 'baseline' | 'stretch';
    wrap?: boolean;
    style?: CSSProperties;
}) {
    return (
        <div
            className="antara-row"
            style={{
                display: 'flex', flexDirection: 'row', gap,
                alignItems: align, flexWrap: wrap ? 'wrap' : 'nowrap',
                ...style,
            }}
        >
            {children}
        </div>
    );
}

/** `repeat(auto-fit, minmax(N, 1fr))` — needs no breakpoints. */
export function Grid({
    children, min = 240, gap = 12, style,
}: {
    children: ReactNode;
    min?: number;
    gap?: number;
    style?: CSSProperties;
}) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
            gap,
            ...style,
        }}>
            {children}
        </div>
    );
}

/**
 * A titled region with an optional corner action.
 *
 * The repeated unit on every screen. The title is a caption, not a heading —
 * a heading is the screen; this is a compartment inside it.
 */
export function Section({
    title, action, children, style,
}: {
    title?: string;
    action?: ReactNode;
    children: ReactNode;
    style?: CSSProperties;
}) {
    return (
        <section style={{ marginBottom: 16, minWidth: 0, ...style }}>
            {(title || action) && (
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 12, marginBottom: 10,
                }}>
                    {title && (
                        <h2 style={{
                            margin: 0, fontSize: 11, letterSpacing: '0.14em',
                            textTransform: 'uppercase', color: antara.inkFaint,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontWeight: 500,
                        }}>
                            {title}
                        </h2>
                    )}
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

/**
 * Application chrome: sidebar on wide viewports, tab bar on narrow.
 *
 * The library does not measure the viewport — that is a DOM concern and a
 * React Native port would use a different signal. The app passes `mode`.
 */
export function Shell({
    mode, brand, nav, header, children,
}: {
    mode: 'tabs' | 'sidebar';
    brand?: ReactNode;
    nav: ReactNode;
    header?: ReactNode;
    children: ReactNode;
}) {
    if (mode === 'sidebar') {
        return (
            <div style={{
                display: 'flex', minHeight: '100vh',
                paddingTop: 'env(safe-area-inset-top)',
            }}>
                <aside style={{
                    width: 220, flexShrink: 0,
                    borderRight: `1px solid ${antara.line}`,
                    padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 8,
                    position: 'sticky', top: 0, alignSelf: 'flex-start',
                    height: '100vh', overflow: 'auto',
                }}>
                    {brand}
                    {nav}
                </aside>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    {header}
                    <div style={{ flex: 1 }}>{children}</div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh' }}>
            {header}
            {children}
            {nav}
        </div>
    );
}
