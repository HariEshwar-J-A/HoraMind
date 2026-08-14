import type { CSSProperties, ReactNode } from 'react';
import { colors, radius, space, touchTarget, toWebStyle, type Style } from '../theme/tokens.js';

/**
 * Layout and control primitives.
 *
 * These exist so screens never touch the DOM directly. A screen composes
 * `<Box>`, `<Txt>`, `<Button>` and `<Field>`; the React Native port replaces
 * this one file with `View`, `Text`, `Pressable` and `TextInput`, and every
 * screen above it compiles unchanged.
 *
 * Styles are token objects, converted to CSS only at this boundary.
 */

function css(...styles: Array<Style | undefined>): CSSProperties {
    const merged: Style = {};
    for (const s of styles) if (s) Object.assign(merged, s);
    return toWebStyle(merged) as CSSProperties;
}

export function Box({ style, children, onClick, active }: {
    style?: Style;
    children?: ReactNode;
    onClick?: () => void;
    /**
     * Marks this box as the selected one in a group, as `data-active`.
     *
     * A named prop rather than letting screens spread arbitrary DOM attributes
     * through: `data-*` is a web concept, and the moment a screen writes one
     * directly it stops being portable. React Native's equivalent is a ref on
     * the selected row, which this same prop can drive.
     */
    active?: boolean;
}) {
    return (
        <div style={css(style)} onClick={onClick} data-active={active ? 'true' : undefined}>
            {children}
        </div>
    );
}

export function Txt({ style, children, as = 'p' }: {
    style?: Style;
    children?: ReactNode;
    as?: 'p' | 'h1' | 'h2' | 'h3' | 'span';
}) {
    const Tag = as;
    return <Tag style={css({ margin: 0, color: colors.text }, style)}>{children}</Tag>;
}

export function Button({ label, onPress, variant = 'primary', disabled, style }: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
    style?: Style;
}) {
    const palette: Record<string, Style> = {
        primary:   { backgroundColor: colors.accent, color: '#1A1503' },
        secondary: { backgroundColor: colors.surfaceRaised, color: colors.text },
        danger:    { backgroundColor: colors.danger, color: '#fff' },
        ghost:     { backgroundColor: 'transparent', color: colors.textMuted },
    };

    return (
        <button
            type="button"
            onClick={onPress}
            disabled={disabled}
            style={css(
                {
                    // Never smaller than a comfortable touch target. The app is
                    // mobile-first and a 32px button is a mis-tap generator.
                    minHeight: touchTarget,
                    paddingLeft: space.lg,
                    paddingRight: space.lg,
                    borderRadius: radius.md,
                    borderWidth: 0,
                    fontSize: 16,
                    fontWeight: '600',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.5 : 1,
                    width: '100%',
                },
                palette[variant],
                style,
            )}
        >
            {label}
        </button>
    );
}

export function Field({ label, value, onChange, type = 'text', placeholder, hint, error }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: 'text' | 'email' | 'password' | 'date' | 'time';
    placeholder?: string;
    hint?: string;
    error?: string | null;
}) {
    return (
        <Box style={{ marginBottom: space.lg }}>
            <Txt as="span" style={{ ...caption, display: 'block', marginBottom: space.xs }}>
                {label}
            </Txt>
            <input
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
                style={css({
                    width: '100%',
                    minHeight: touchTarget,
                    padding: space.md,
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: error ? colors.danger : colors.border,
                    borderRadius: radius.md,
                    // 16px minimum: anything smaller makes iOS Safari zoom the
                    // viewport on focus and the layout never recovers.
                    fontSize: 16,
                    boxSizing: 'border-box',
                })}
            />
            {(hint || error) && (
                <Txt style={{ ...caption, color: error ? colors.danger : colors.textFaint, marginTop: space.xs }}>
                    {error ?? hint}
                </Txt>
            )}
        </Box>
    );
}

export function Card({ children, style }: { children: ReactNode; style?: Style }) {
    return (
        <Box style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: space.lg,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: colors.border,
            marginBottom: space.md,
            ...style,
        }}>
            {children}
        </Box>
    );
}

export function Screen({ children, title }: { children: ReactNode; title?: string }) {
    return (
        <Box style={{
            minHeight: '100vh',
            // Transparent, not the background colour: the starfield is painted
            // once behind the whole app, and a screen that paints over it would
            // put every page in a black box on top of the sky.
            backgroundColor: 'transparent',
            padding: space.lg,
            // Keep content clear of the notch and the home indicator.
            paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)',
            maxWidth: 720,
            marginLeft: 'auto',
            marginRight: 'auto',
        }}>
            {title && <Txt as="h1" style={{ fontSize: 28, fontWeight: '600', marginBottom: space.lg }}>{title}</Txt>}
            {children}
        </Box>
    );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' }) {
    const border = tone === 'error' ? colors.danger : tone === 'warn' ? colors.accent : colors.neutral;
    return (
        <Box style={{
            padding: space.md,
            borderRadius: radius.md,
            borderLeftWidth: 3,
            borderLeftStyle: 'solid',
            borderLeftColor: border,
            backgroundColor: colors.surfaceRaised,
            marginBottom: space.md,
        }}>
            <Txt style={{ fontSize: 14, color: colors.textMuted }}>{children}</Txt>
        </Box>
    );
}

const caption: Style = { fontSize: 12, fontWeight: '500', color: colors.textMuted };
