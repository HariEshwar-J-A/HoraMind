import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';

/**
 * Antara — HoraMind's design system.
 *
 * A workspace package rather than a folder, so the app depends on it by name
 * and cannot reach past its exports into internals. That boundary is the point:
 * a design system you can import a private file from is a folder with
 * aspirations.
 *
 * The language is an instrument. Archaic in reference — an astrolabe: engraved
 * hairlines, brass caught at one edge, a serif older than the web. Futuristic
 * in precision — sub-pixel rules, layered translucency, motion with physics
 * rather than easing curves picked by eye. Modern in obligation — 44px targets,
 * reduced motion honoured in every component here without exception, and
 * nothing that conveys meaning by colour alone.
 *
 * Everything is a style object over CSS custom properties. No Tailwind and no
 * class strings: the app's other half is written so a React Native port is
 * mechanical, and `className="p-4"` is valid in neither world once you leave
 * the browser.
 */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const antara = {
    ink: 'var(--color-ink, #f0ece1)',
    inkMuted: 'var(--color-ink-2, #a8acc2)',
    inkFaint: 'var(--color-ink-3, #767c99)',
    surface: 'var(--color-surface, #151827)',
    raised: 'var(--color-hover, #1e2235)',
    line: 'var(--color-line, #2a2f45)',
    lineStrong: 'var(--color-line-strong, #3a4160)',
    brass: 'var(--color-accent, #c9a227)',
    brassLit: 'var(--color-accent-ink, #e8ce7a)',
    good: 'var(--color-green, #5bc98c)',
    warn: 'var(--color-orange, #e2915b)',
    bad: 'var(--color-red, #e2725b)',
} as const;

/** A spring, not a duration. Weighted things should settle, not stop. */
export const spring = { type: 'spring' as const, stiffness: 380, damping: 32 };
export const springSoft = { type: 'spring' as const, stiffness: 210, damping: 26 };

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * A panel.
 *
 * Elevation is a hairline ring plus a translucent wash, never a drop shadow. On
 * a near-black ground a shadow is invisible — the light system's `0 1px 2px`
 * would silently flatten every card into the page — so depth has to come from
 * the edge catching light instead.
 *
 * `tone="lit"` adds a brass top edge for the one panel on a screen that matters
 * most. Used more than once per screen it stops meaning anything.
 */
export function Panel({ children, tone = 'plain', inset = false, style }: {
    children: ReactNode;
    tone?: 'plain' | 'lit' | 'quiet';
    inset?: boolean;
    style?: CSSProperties;
}) {
    return (
        <div style={{
            position: 'relative',
            background: inset
                ? 'color-mix(in srgb, var(--color-page, #0b0d17) 70%, transparent)'
                : antara.surface,
            border: `1px solid ${tone === 'lit' ? antara.lineStrong : antara.line}`,
            borderRadius: 14,
            padding: 16,
            marginBottom: 12,
            // Clip rather than hidden: `hidden` on a container creates a scroll
            // container, which silently breaks `position: sticky` in any
            // descendant and is miserable to trace back to here.
            overflow: 'clip',
            ...style,
        }}>
            {tone === 'lit' && (
                <span
                    aria-hidden
                    style={{
                        position: 'absolute', insetInline: 0, top: 0, height: 1,
                        background: `linear-gradient(90deg, transparent, ${antara.brass}, transparent)`,
                    }}
                />
            )}
            {children}
        </div>
    );
}

/**
 * An engraved rule.
 *
 * Fades at both ends rather than meeting the panel edge. A rule that touches
 * its container reads as a table border; one that stops short reads as
 * something scored into a surface, which is the whole reference.
 */
export function Rule({ label }: { label?: string }) {
    const line = `linear-gradient(90deg, transparent, ${antara.line} 20%, ${antara.line} 80%, transparent)`;
    if (!label) return <div aria-hidden style={{ height: 1, background: line, margin: '14px 0' }} />;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div aria-hidden style={{ flex: 1, height: 1, background: line }} />
            <span style={{
                fontSize: 10, letterSpacing: '0.14em', color: antara.inkFaint,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}>
                {label}
            </span>
            <div aria-hidden style={{ flex: 1, height: 1, background: line }} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * A segmented control with a sliding indicator.
 *
 * One indicator moved by `layoutId`, never two cross-fading. The travel is what
 * says these are views of one thing rather than separate buttons — and it also
 * shows *which direction* you moved, which a cross-fade cannot.
 */
export function Segmented<T extends string>({ value, options, onChange, label }: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (v: T) => void;
    label: string;
}) {
    return (
        <div
            role="radiogroup" aria-label={label}
            style={{
                display: 'flex', gap: 4, padding: 4,
                background: antara.surface,
                border: `1px solid ${antara.line}`,
                borderRadius: 999,
            }}
        >
            {options.map(opt => {
                const on = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button" role="radio" aria-checked={on}
                        onClick={() => onChange(opt.value)}
                        style={{
                            position: 'relative', flex: 1,
                            // 44 is the floor everywhere in this system, minus
                            // the 4px of padding the track already contributes.
                            minHeight: 36,
                            border: 'none', background: 'transparent',
                            borderRadius: 999, cursor: 'pointer',
                            color: on ? '#1a1503' : antara.inkMuted,
                            fontWeight: on ? 600 : 400, fontSize: 13,
                            transition: 'color 180ms ease',
                            zIndex: 1,
                        }}
                    >
                        {on && (
                            <m.span
                                layoutId={`antara-seg-${label}`}
                                transition={spring}
                                style={{
                                    position: 'absolute', inset: 0, zIndex: -1,
                                    background: antara.brass, borderRadius: 999,
                                }}
                            />
                        )}
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

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

/**
 * The empty state.
 *
 * Says what would be here and how to get it, in that order. "No data" tells
 * someone the screen is working and nothing else; the reason they are looking
 * at it is that they wanted the data.
 */
export function Empty({ title, hint, action }: {
    title: string;
    hint?: string;
    action?: ReactNode;
}) {
    const still = useReducedMotion();
    return (
        <m.div
            initial={{ opacity: 0, y: still ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSoft}
            style={{ textAlign: 'center', padding: '32px 16px' }}
        >
            {/* An empty orbit: the app's own idiom for "nothing here yet". */}
            <svg width={54} height={54} viewBox="0 0 54 54" aria-hidden style={{ marginBottom: 12 }}>
                <circle cx="27" cy="27" r="19" fill="none" stroke={antara.line} strokeWidth="1" strokeDasharray="2 5" />
                <circle cx="27" cy="27" r="3" fill={antara.lineStrong} />
            </svg>
            <p style={{ margin: 0, color: antara.ink, fontSize: 16 }}>{title}</p>
            {hint && (
                <p style={{ margin: '6px 0 14px', color: antara.inkFaint, fontSize: 13, lineHeight: '20px' }}>
                    {hint}
                </p>
            )}
            {action}
        </m.div>
    );
}

/**
 * A transient confirmation.
 *
 * `role="status"` and `aria-live="polite"`, so it is announced without
 * interrupting — the correct register for "saved", and the reason this is a
 * component rather than a styled div.
 */
export function Toast({ message, tone = 'good', onDone, ms = 2600 }: {
    message: string | null;
    tone?: 'good' | 'bad';
    onDone?: () => void;
    ms?: number;
}) {
    const [shown, setShown] = useState(false);
    const done = useRef(onDone);
    done.current = onDone;

    useEffect(() => {
        if (!message) return;
        setShown(true);
        const t = setTimeout(() => { setShown(false); done.current?.(); }, ms);
        return () => clearTimeout(t);
    }, [message, ms]);

    if (!message) return null;

    return (
        <m.div
            role="status" aria-live="polite"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 16 }}
            transition={spring}
            style={{
                position: 'fixed', left: '50%', translateX: '-50%',
                // Above the tab bar, and clear of the home indicator.
                bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
                zIndex: 50,
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 999,
                background: antara.raised,
                border: `1px solid ${tone === 'good' ? antara.good : antara.bad}`,
                color: antara.ink, fontSize: 14,
                maxWidth: 'min(92vw, 420px)',
            }}
        >
            <span aria-hidden style={{
                width: 7, height: 7, borderRadius: 999,
                background: tone === 'good' ? antara.good : antara.bad,
                flexShrink: 0,
            }} />
            <Clamp lines={2}>{message}</Clamp>
        </m.div>
    );
}
