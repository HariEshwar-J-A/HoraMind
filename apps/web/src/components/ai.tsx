import { useEffect, useState } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';
import { brass, colors, fonts, motion as mo, radius, space, type } from '../theme/tokens.js';

/**
 * Components for the AI surfaces.
 *
 * The patterns are borrowed from Beautiful UI's AI-native primitives — a
 * shimmer for pending data, a visible working state, text that arrives
 * progressively — because they are the right vocabulary for an interface where
 * a request can take ten seconds and the user needs to believe it is alive.
 *
 * The *look* is not borrowed. Beautiful UI is a light, teal-and-orange system
 * built for data-dense agent consoles; this app is a night sky read in the
 * evening, and importing that palette would have replaced HoraMind's identity
 * with a stranger's. Structure travels, colour does not.
 */

/**
 * Skeleton for content that has been requested and not yet arrived.
 *
 * A sweep rather than a pulse: a pulse says "busy", a sweep says "filling", and
 * the second is a truer description of a chart that is being computed. Under
 * reduced motion the sweep stops and the block simply sits there, which still
 * communicates "not yet" without moving anything.
 */
export function Shimmer({ height = 16, width = '100%', radius: r = radius.sm }: {
    height?: number;
    width?: number | string;
    radius?: number;
}) {
    const still = useReducedMotion();

    return (
        <div
            aria-hidden="true"
            style={{
                height, width, borderRadius: r,
                backgroundColor: colors.surfaceRaised,
                position: 'relative', overflow: 'hidden',
                marginBottom: space.sm,
            }}
        >
            {!still && (
                <m.div
                    initial={{ x: '-120%' }}
                    animate={{ x: '220%' }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    style={{
                        position: 'absolute', inset: 0,
                        background: `linear-gradient(90deg, transparent, ${brass.glow}, transparent)`,
                    }}
                />
            )}
        </div>
    );
}

/**
 * The working state for a request that takes real time.
 *
 * It shows an elapsed count, which is the one honest thing this component can
 * say. It deliberately does *not* narrate invented steps — "consulting the
 * classical texts…", "weighing the yogas…" — because the client issues a single
 * request and knows nothing about what the server is doing. Inventing a
 * reasoning trace to fill the wait would be the interface telling a small lie
 * on behalf of a product whose entire claim is that it does not.
 */
export function Working({ label = 'Reading the chart' }: { label?: string }) {
    const still = useReducedMotion();
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setElapsed(e => e + 1), 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: mo.base, ease: mo.standard }}
            style={{
                display: 'flex', alignItems: 'center', gap: space.md,
                padding: space.lg,
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.lg,
                marginBottom: space.md,
            }}
        >
            {/* A body on an orbit — the app's own idiom for "in progress". */}
            <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="10" fill="none" stroke={colors.border} strokeWidth="1" />
                <m.g
                    animate={still ? undefined : { rotate: 360 }}
                    transition={still ? undefined : { duration: 3.2, repeat: Infinity, ease: 'linear' }}
                    style={{ transformOrigin: '13px 13px' }}
                >
                    <circle cx="23" cy="13" r="2.2" fill={brass.light} />
                </m.g>
                <circle cx="13" cy="13" r="2.6" fill={brass.deep} />
            </svg>

            <div style={{ flex: 1 }}>
                <p style={{ margin: 0, ...type.small, color: colors.text, fontFamily: fonts.display }}>
                    {label}
                </p>
                <p style={{ margin: 0, ...type.caption, color: colors.textFaint, fontFamily: fonts.mono }}>
                    {elapsed}s
                </p>
            </div>
        </m.div>
    );
}

/**
 * Reveal a finished answer progressively, a few words at a time.
 *
 * To be clear about what this is: `/v1/interpret` returns the whole answer in
 * one response, so nothing here is streaming. This is a reading aid — a wall of
 * text appearing at once is markedly harder to start reading than one that
 * arrives at a pace. The prop shape matches a real token stream, so if the
 * endpoint ever streams, this component takes it without a rewrite.
 *
 * Reduced motion prints the whole answer immediately; someone who has asked for
 * less movement has not asked to read more slowly.
 */
export function StreamingText({ text, wordsPerTick = 3, tickMs = 28 }: {
    text: string;
    wordsPerTick?: number;
    tickMs?: number;
}) {
    const still = useReducedMotion();
    const words = text.split(' ');
    const [shown, setShown] = useState(still ? words.length : 0);

    useEffect(() => {
        if (still) { setShown(words.length); return; }
        setShown(0);
        const id = setInterval(() => {
            setShown(n => {
                if (n >= words.length) { clearInterval(id); return n; }
                return n + wordsPerTick;
            });
        }, tickMs);
        return () => clearInterval(id);
    }, [text, still, words.length, wordsPerTick, tickMs]);

    const done = shown >= words.length;

    return (
        <p style={{
            margin: 0, ...type.body, color: colors.text,
            whiteSpace: 'pre-wrap', lineHeight: 26,
        }}>
            {words.slice(0, shown).join(' ')}
            {!done && (
                <m.span
                    animate={{ opacity: [1, 0.15, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                    style={{
                        display: 'inline-block', width: 7, height: 15,
                        backgroundColor: brass.mid, marginLeft: 3,
                        verticalAlign: 'text-bottom',
                    }}
                />
            )}
        </p>
    );
}
