import type { CSSProperties } from 'react';

/**
 * Text that cannot overflow its container.
 *
 * Two failure modes, one component. `lines={1}` truncates with an ellipsis;
 * more than one clamps. Both set `min-width: 0`, without which a flex parent
 * refuses to shrink the child below its content and the truncation silently
 * does nothing — the row overflows instead, which is the confusing outcome.
 *
 * `title` carries the full string so a truncated value is still recoverable by
 * hover and by a screen reader.
 */
export function Clamp({ children, lines = 1, style }: {
    children: string;
    lines?: number;
    style?: CSSProperties;
}) {
    return (
        <span
            title={children}
            style={{
                display: '-webkit-box',
                WebkitLineClamp: lines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                minWidth: 0,
                ...style,
            }}
        >
            {children}
        </span>
    );
}
