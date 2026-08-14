import type { CSSProperties, ReactNode } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';
import { antara, springSoft } from './tokens.js';
import { Clamp } from './clamp.js';

export function Skeleton({
    height = 16, width = '100%', radius = 6, style,
}: {
    height?: number;
    width?: number | string;
    radius?: number;
    style?: CSSProperties;
}) {
    const still = useReducedMotion();
    return (
        <div
            aria-hidden
            style={{
                height, width, borderRadius: radius,
                background: antara.raised, position: 'relative', overflow: 'hidden',
                marginBottom: 8, ...style,
            }}
        >
            {!still && (
                <m.div
                    initial={{ x: '-120%' }}
                    animate={{ x: '220%' }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    style={{
                        position: 'absolute', inset: 0,
                        background: `linear-gradient(90deg, transparent, ${antara.brass}33, transparent)`,
                    }}
                />
            )}
        </div>
    );
}

export function Badge({
    children, tone = 'plain', shape = 'pill',
}: {
    children: string;
    tone?: 'plain' | 'good' | 'warn' | 'bad';
    shape?: 'pill' | 'square';
}) {
    const colour = tone === 'good' ? antara.good
        : tone === 'warn' ? antara.warn
        : tone === 'bad' ? antara.bad
        : antara.inkMuted;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11, letterSpacing: 0.4, color: colour,
            border: `1px solid ${colour}`,
            borderRadius: shape === 'pill' ? 999 : 4,
            padding: '2px 8px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
            <span aria-hidden style={{
                width: 6, height: 6, borderRadius: shape === 'pill' ? 999 : 1,
                background: colour, flexShrink: 0,
            }} />
            {children}
        </span>
    );
}

/** Initials fallback; colour is deterministic from `seed` so it never flickers. */
export function Avatar({ name, seed, size = 36 }: { name: string; seed: string; size?: number }) {
    const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hues = ['#5bc98c', '#e8ce7a', '#7b8cde', '#e2915b', '#c9a227'];
    const bg = hues[Math.abs(hash) % hues.length];
    return (
        <span aria-hidden style={{
            width: size, height: size, borderRadius: 999, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: bg, color: '#0b0d17', fontWeight: 700, fontSize: size * 0.38,
        }}>
            {initials}
        </span>
    );
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
    const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            style={{
                height: 6, borderRadius: 999, background: antara.line, overflow: 'hidden',
            }}
        >
            <div style={{
                width: `${pct}%`, height: '100%', background: antara.brass, borderRadius: 999,
            }} />
        </div>
    );
}

/**
 * What failed, whether retrying helps, and a retry that actually refetches.
 *
 * An error state without a retry is a dead end; one that reloads the whole
 * page throws away everything the user had typed.
 */
export function ErrorState({
    title, hint, retryable = true, onRetry, style,
}: {
    title: string;
    hint?: string;
    retryable?: boolean;
    onRetry?: () => void;
    style?: CSSProperties;
}) {
    const still = useReducedMotion();
    return (
        <m.div
            initial={{ opacity: 0, y: still ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springSoft}
            style={{ textAlign: 'center', padding: '28px 16px', ...style }}
        >
            <p style={{ margin: 0, color: antara.ink, fontSize: 16 }}>{title}</p>
            {hint && (
                <p style={{ margin: '6px 0 14px', color: antara.inkFaint, fontSize: 13, lineHeight: '20px' }}>
                    {hint}
                </p>
            )}
            {retryable && onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    style={{
                        minHeight: 44, padding: '0 16px', borderRadius: 10,
                        border: `1px solid ${antara.line}`, background: antara.raised,
                        color: antara.ink, fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Try again
                </button>
            )}
        </m.div>
    );
}

/**
 * Hover tooltip on pointer devices; long-press is the caller's problem on
 * touch, and this must never be the only route to the information.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
    return (
        <span title={label} style={{ display: 'inline-flex' }}>
            {children}
        </span>
    );
}

/**
 * Horizontal scroll lives *inside* the table, with a sticky first column.
 * Never at page level — that is how a wide planet table puts the whole app
 * into sideways scroll.
 */
export function Table({
    columns, rows, caption,
}: {
    columns: ReadonlyArray<{ key: string; label: string; numeric?: boolean }>;
    rows: ReadonlyArray<Record<string, string>>;
    caption?: string;
}) {
    const first = columns[0]?.key;
    return (
        <div style={{ overflowX: 'auto', marginBottom: 12 }} className="antara-plain-scroll">
            <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 14, color: antara.ink,
            }}>
                {caption && <caption style={{
                    captionSide: 'top', textAlign: 'left', paddingBottom: 8,
                    color: antara.inkFaint, fontSize: 11, letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}>{caption}</caption>}
                <thead>
                    <tr>
                        {columns.map((c, i) => (
                            <th key={c.key} style={{
                                textAlign: c.numeric ? 'right' : 'left',
                                padding: '8px 10px',
                                borderBottom: `1px solid ${antara.line}`,
                                color: antara.inkMuted, fontWeight: 500, fontSize: 12,
                                position: i === 0 ? 'sticky' : undefined,
                                left: i === 0 ? 0 : undefined,
                                background: i === 0 ? antara.surface : undefined,
                            }}>
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, r) => (
                        <tr key={r}>
                            {columns.map((c, i) => (
                                <td key={c.key} style={{
                                    textAlign: c.numeric ? 'right' : 'left',
                                    padding: '10px 10px',
                                    borderBottom: `1px solid ${antara.line}`,
                                    position: i === 0 ? 'sticky' : undefined,
                                    left: i === 0 ? 0 : undefined,
                                    background: i === 0 ? antara.surface : undefined,
                                    whiteSpace: i === 0 ? 'nowrap' : undefined,
                                    maxWidth: 220,
                                }}>
                                    <Clamp lines={1}>{row[c.key] ?? ''}</Clamp>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {first && rows.length === 0 && (
                <p style={{ color: antara.inkFaint, fontSize: 13, padding: 16, margin: 0 }}>
                    Nothing to show.
                </p>
            )}
        </div>
    );
}

export function ToastStack({
    items, onDismiss,
}: {
    items: ReadonlyArray<{ id: string; message: string; tone?: 'good' | 'bad' }>;
    onDismiss: (id: string) => void;
}) {
    if (items.length === 0) return null;
    return (
        <div style={{
            position: 'fixed', left: '50%', translate: '-50% 0',
            bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
            zIndex: 50, display: 'flex', flexDirection: 'column', gap: 8,
            width: 'min(92vw, 420px)',
        }}>
            {items.map(item => (
                <button
                    key={item.id}
                    type="button"
                    onClick={() => onDismiss(item.id)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 16px', borderRadius: 999,
                        background: antara.raised,
                        border: `1px solid ${item.tone === 'bad' ? antara.bad : antara.good}`,
                        color: antara.ink, fontSize: 14, cursor: 'pointer', textAlign: 'left',
                    }}
                >
                    <span aria-hidden style={{
                        width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                        background: item.tone === 'bad' ? antara.bad : antara.good,
                    }} />
                    <Clamp lines={2}>{item.message}</Clamp>
                </button>
            ))}
        </div>
    );
}
