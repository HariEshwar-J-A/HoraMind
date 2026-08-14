import { useEffect, useRef, type ReactNode } from 'react';
import { space } from '../theme/tokens.js';

/**
 * A horizontally scrolling row that keeps the active item in view.
 *
 * Lives here rather than in the screen because it needs two things the screen
 * is not allowed to touch: a DOM ref, and the scrollbar-hiding CSS that has no
 * token equivalent. `screens/` is lint-guarded against both so a React Native
 * port stays mechanical, and the native answer is a `FlatList` with
 * `initialScrollIndex` — a swap of this one file.
 *
 * Without the centring, a fifteen-day strip opens on the *oldest* day and the
 * user's today sits half-clipped at the right edge, which is exactly what the
 * first version did. The scroll is instant on mount rather than smooth: an
 * animated scroll on first paint reads as the page settling badly, and there is
 * nothing to follow because the user has not moved anything yet.
 */
export function DayStrip({ children, activeKey }: {
    children: ReactNode;
    /** Changing this re-centres. Pass the selected day's date. */
    activeKey: string;
}) {
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const active = el.querySelector<HTMLElement>('[data-active="true"]');
        if (!active) return;

        // Centre it manually rather than using scrollIntoView, which scrolls
        // every ancestor — including the page — and would yank the whole screen
        // down to the strip on arrival.
        el.scrollLeft = active.offsetLeft - (el.clientWidth - active.clientWidth) / 2;
    }, [activeKey]);

    return (
        <div
            ref={scroller}
            style={{
                display: 'flex',
                gap: space.xs,
                overflowX: 'auto',
                paddingBottom: space.xs,
                marginBottom: space.md,
                // The native bar is a grey slab across a night sky and the row
                // is obviously swipeable without it.
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
            }}
            className="hm-no-scrollbar"
        >
            {children}
        </div>
    );
}
