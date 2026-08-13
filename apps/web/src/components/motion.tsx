import type { ReactNode } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';
import { motion as mo, radius, colors, space } from '../theme/tokens.js';
import { toWebStyle, type Style } from '../theme/tokens.js';

/**
 * Motion primitives.
 *
 * Screens describe *what* should arrive and in what order; this file decides
 * how. That split is the same one `primitives.tsx` makes for layout, and for
 * the same reason — a React Native port swaps these four components for their
 * Reanimated equivalents and every screen above compiles unchanged.
 *
 * Every component here honours `prefers-reduced-motion`. Not as a courtesy: the
 * app opens on a starfield and animates planets into orbit, which is precisely
 * the vestibular-trigger category the setting exists for. Reduced motion means
 * content still *arrives* — it simply arrives already in place, rather than
 * being denied the transition and left invisible.
 */

/**
 * Reveal one element.
 *
 * `delay` is in seconds and is usually left alone — prefer wrapping siblings in
 * `<Stagger>`, which computes the delays so a later insertion cannot silently
 * land out of sequence.
 */
export function Reveal({ children, delay = 0, y = 14, style }: {
    children: ReactNode;
    delay?: number;
    /** Distance travelled on entry. 0 for a pure fade. */
    y?: number;
    style?: Style;
}) {
    const still = useReducedMotion();

    return (
        <m.div
            initial={{ opacity: 0, y: still ? 0 : y }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: still ? 0.01 : mo.base, delay: still ? 0 : delay, ease: mo.standard }}
            style={style ? (toWebStyle(style) as React.CSSProperties) : undefined}
        >
            {children}
        </m.div>
    );
}

/**
 * Reveal children in sequence.
 *
 * Uses Motion's variant propagation rather than per-child delays, so children
 * added later inherit the rhythm automatically and the parent stays the single
 * place the timing is defined.
 */
export function Stagger({ children, delay = 0, gap = mo.stagger }: {
    children: ReactNode;
    delay?: number;
    gap?: number;
}) {
    const still = useReducedMotion();

    return (
        <m.div
            initial="hidden"
            animate="shown"
            variants={{
                hidden: {},
                shown: { transition: { staggerChildren: still ? 0 : gap, delayChildren: still ? 0 : delay } },
            }}
        >
            {children}
        </m.div>
    );
}

/** A child of `<Stagger>`. Inherits its turn in the sequence from the parent. */
export function StaggerItem({ children, y = 16, style }: {
    children: ReactNode;
    y?: number;
    style?: Style;
}) {
    const still = useReducedMotion();

    return (
        <m.div
            variants={{
                hidden: { opacity: 0, y: still ? 0 : y },
                shown: { opacity: 1, y: 0, transition: { duration: still ? 0.01 : mo.base, ease: mo.standard } },
            }}
            style={style ? (toWebStyle(style) as React.CSSProperties) : undefined}
        >
            {children}
        </m.div>
    );
}

/**
 * A card that responds to being touched.
 *
 * The press scale is deliberately tiny (0.985). On a phone the finger covers
 * the element, so the feedback is felt at the edges rather than seen; anything
 * larger reads as the layout collapsing.
 */
export function PressCard({ children, onPress, style }: {
    children: ReactNode;
    onPress?: () => void;
    style?: Style;
}) {
    const still = useReducedMotion();

    return (
        <m.div
            onClick={onPress}
            whileHover={still || !onPress ? undefined : { scale: 1.006, borderColor: colors.textFaint }}
            whileTap={still || !onPress ? undefined : { scale: 0.985 }}
            transition={{ duration: mo.fast, ease: mo.standard }}
            style={{
                ...(toWebStyle({
                    backgroundColor: colors.surface,
                    borderRadius: radius.lg,
                    padding: space.lg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    marginBottom: space.md,
                    ...style,
                }) as React.CSSProperties),
                borderStyle: 'solid',
                cursor: onPress ? 'pointer' : undefined,
            }}
        >
            {children}
        </m.div>
    );
}
