import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';
import { antara, spring, springSoft } from './tokens.js';
import { Clamp } from './clamp.js';

const TOUCH = 44;

export function Button({
    label, onPress, variant = 'primary', disabled, loading, style,
}: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    disabled?: boolean;
    loading?: boolean;
    style?: CSSProperties;
}) {
    const palette: Record<string, CSSProperties> = {
        primary:   { background: antara.brass, color: '#1a1503' },
        secondary: { background: antara.raised, color: antara.ink, border: `1px solid ${antara.line}` },
        ghost:     { background: 'transparent', color: antara.inkMuted },
        danger:    { background: antara.bad, color: '#fff' },
    };
    const busy = disabled || loading;
    return (
        <button
            type="button"
            onClick={onPress}
            disabled={busy}
            aria-busy={loading || undefined}
            style={{
                minHeight: TOUCH, minWidth: TOUCH,
                padding: '0 16px', borderRadius: 10, border: 'none',
                fontSize: 16, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1, width: '100%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                gap: 8, ...palette[variant], ...style,
            }}
        >
            {loading && (
                <span aria-hidden style={{
                    width: 14, height: 14, borderRadius: 999,
                    border: '2px solid currentColor', borderRightColor: 'transparent',
                    animation: 'antara-spin 0.7s linear infinite', flexShrink: 0,
                }} />
            )}
            <Clamp lines={1}>{loading ? label : label}</Clamp>
        </button>
    );
}

export function IconButton({
    label, onPress, children, disabled, style,
}: {
    /** Required: icon buttons have no visible text. */
    label: string;
    onPress: () => void;
    children: ReactNode;
    disabled?: boolean;
    style?: CSSProperties;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onPress}
            disabled={disabled}
            style={{
                width: TOUCH, height: TOUCH, minWidth: TOUCH, minHeight: TOUCH,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', background: 'transparent', color: antara.ink,
                borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1, flexShrink: 0, ...style,
            }}
        >
            {children}
        </button>
    );
}

export function Field({
    label, value, onChange, type = 'text', placeholder, hint, error, prefix, suffix,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: 'text' | 'email' | 'password' | 'date' | 'time';
    placeholder?: string;
    hint?: string;
    error?: string | null;
    prefix?: ReactNode;
    suffix?: ReactNode;
}) {
    const id = useId();
    const hintId = `${id}-hint`;
    return (
        <label htmlFor={id} style={{ display: 'block', marginBottom: 16 }}>
            <span style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: antara.inkMuted, marginBottom: 4,
            }}>
                {label}
            </span>
            <span style={{
                display: 'flex', alignItems: 'center', gap: 8,
                minHeight: TOUCH, padding: '0 12px',
                background: antara.surface,
                border: `1px solid ${error ? antara.bad : antara.line}`,
                borderRadius: 10,
            }}>
                {prefix}
                <input
                    id={id}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    onChange={e => onChange(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={hint || error ? hintId : undefined}
                    style={{
                        flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                        color: antara.ink, fontSize: 16, outline: 'none',
                        minHeight: TOUCH - 2,
                    }}
                />
                {suffix}
            </span>
            {(hint || error) && (
                <span id={hintId} style={{
                    display: 'block', fontSize: 12, marginTop: 4,
                    color: error ? antara.bad : antara.inkFaint,
                }}>
                    {error ?? hint}
                </span>
            )}
        </label>
    );
}

/**
 * Native `<select>` on purpose.
 *
 * The OS picker is already localised, already accessible, and already the
 * thing a thumb knows how to use. A custom listbox is only worth the cost
 * above ~900px, and even then it is a progressive enhancement.
 */
export function Select({
    label, value, options, onChange, hint,
}: {
    label: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (v: string) => void;
    hint?: string;
}) {
    const id = useId();
    return (
        <label htmlFor={id} style={{ display: 'block', marginBottom: 16 }}>
            <span style={{
                display: 'block', fontSize: 12, fontWeight: 500,
                color: antara.inkMuted, marginBottom: 4,
            }}>
                {label}
            </span>
            <select
                id={id}
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{
                    width: '100%', minHeight: TOUCH, padding: '0 12px',
                    background: antara.surface, color: antara.ink,
                    border: `1px solid ${antara.line}`, borderRadius: 10,
                    fontSize: 16,
                }}
            >
                {options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
            {hint && (
                <span style={{ display: 'block', fontSize: 12, marginTop: 4, color: antara.inkFaint }}>
                    {hint}
                </span>
            )}
        </label>
    );
}

/**
 * A calendar date, stored as `YYYY-MM-DD`.
 *
 * Never constructed via `new Date(string)` — that parses as UTC midnight and
 * reports the previous day west of Greenwich.
 */
export function DateField({
    label, value, onChange, hint, error,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    hint?: string;
    error?: string | null;
}) {
    return (
        <Field label={label} type="date" value={value} onChange={onChange} hint={hint} error={error} />
    );
}

export function Tabs<T extends string>({
    value, options, onChange, label,
}: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (v: T) => void;
    label: string;
}) {
    return (
        <div role="tablist" aria-label={label} style={{ display: 'flex', gap: 4, position: 'relative' }}>
            {options.map(opt => {
                const on = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => onChange(opt.value)}
                        style={{
                            position: 'relative', flex: 1, minHeight: TOUCH,
                            border: 'none', background: 'transparent',
                            color: on ? antara.brassLit : antara.inkMuted,
                            fontWeight: on ? 600 : 400, fontSize: 14,
                            cursor: 'pointer',
                        }}
                    >
                        {on && (
                            <m.span
                                layoutId={`antara-tab-${label}`}
                                transition={spring}
                                style={{
                                    position: 'absolute', left: '18%', right: '18%',
                                    bottom: 0, height: 2, background: antara.brass,
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

export function Accordion({
    title, children, defaultOpen = false,
}: {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const still = useReducedMotion();
    return (
        <div style={{
            border: `1px solid ${antara.line}`, borderRadius: 14,
            marginBottom: 12, overflow: 'clip', background: antara.surface,
        }}>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', minHeight: TOUCH, padding: '12px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, border: 'none', background: 'transparent',
                    color: antara.ink, fontSize: 15, cursor: 'pointer', textAlign: 'left',
                }}
            >
                <span style={{ minWidth: 0 }}><Clamp lines={1}>{title}</Clamp></span>
                <m.span
                    aria-hidden
                    animate={{ rotate: open ? 90 : 0 }}
                    transition={still ? { duration: 0.01 } : spring}
                    style={{ flexShrink: 0, color: antara.inkFaint }}
                >
                    ▸
                </m.span>
            </button>
            {open && (
                <m.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={still ? { duration: 0.01 } : springSoft}
                    style={{ padding: '0 16px 16px' }}
                >
                    {children}
                </m.div>
            )}
        </div>
    );
}

/**
 * Bottom sheet on narrow viewports, dialog on wide. The caller decides which
 * via `placement` — measuring the viewport is not this component's job.
 */
export function Sheet({
    open, onClose, title, children, placement = 'sheet',
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    placement?: 'sheet' | 'dialog';
}) {
    const still = useReducedMotion();
    if (!open) return null;

    const panel: CSSProperties = placement === 'dialog'
        ? {
            position: 'fixed', left: '50%', top: '50%',
            translate: '-50% -50%',
            width: 'min(480px, calc(100vw - 32px))',
            maxHeight: '80vh', overflow: 'auto',
            background: antara.surface, border: `1px solid ${antara.lineStrong}`,
            borderRadius: 16, padding: 20, zIndex: 40,
        }
        : {
            position: 'fixed', left: 0, right: 0, bottom: 0,
            maxHeight: '80vh', overflow: 'auto',
            background: antara.surface,
            borderTop: `1px solid ${antara.lineStrong}`,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: '16px 16px calc(env(safe-area-inset-bottom) + 16px)',
            zIndex: 40,
        };

    return (
        <>
            <m.div
                role="presentation"
                onClick={onClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={still ? { duration: 0.01 } : { duration: 0.18 }}
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(11,13,23,0.72)', zIndex: 30,
                }}
            />
            <m.div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                initial={{ opacity: 0, y: still ? 0 : (placement === 'dialog' ? 12 : 24) }}
                animate={{ opacity: 1, y: 0 }}
                transition={still ? { duration: 0.01 } : spring}
                style={panel}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, marginBottom: 12,
                }}>
                    <h2 style={{ margin: 0, fontSize: 18, color: antara.ink }}>{title}</h2>
                    <IconButton label="Close" onPress={onClose}>
                        <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>×</span>
                    </IconButton>
                </div>
                {children}
            </m.div>
        </>
    );
}
