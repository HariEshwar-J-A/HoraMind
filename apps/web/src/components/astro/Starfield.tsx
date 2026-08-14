import { motion as m, useReducedMotion } from 'motion/react';
import { brass, colors } from '../../theme/tokens.js';

/**
 * The sky behind everything.
 *
 * Fixed behind the app at `zIndex: -1`, so it never intercepts a tap and no
 * screen has to know it exists.
 *
 * The stars are generated from a fixed seed rather than `Math.random()`. Two
 * reasons, and the second is the one that matters: a re-render must not
 * reshuffle the sky, and a screenshot diff in the driver must compare two
 * identical starfields or every UI test fails on noise forever.
 */

/**
 * Mulberry32 — a small, fast PRNG with a fixed seed.
 *
 * Any deterministic generator would do; this one is four lines and has no
 * visible lattice at these counts, which matters because the eye is very good
 * at spotting a grid in something claiming to be a sky.
 */
function seeded(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Star { x: number; y: number; r: number; base: number; period: number; delay: number }

const STARS: readonly Star[] = (() => {
    const rand = seeded(20260813);
    return Array.from({ length: 84 }, () => {
        const r = rand();
        return {
            x: rand() * 100,
            y: rand() * 100,
            // Cubed so most stars are faint and a handful are bright — an even
            // spread of sizes looks like scattered dust, not a sky.
            r: 0.06 + r * r * r * 0.5,
            base: 0.18 + rand() * 0.5,
            period: 3.5 + rand() * 6,
            delay: rand() * 6,
        };
    });
})();

export function Starfield() {
    const still = useReducedMotion();

    return (
        <div
            aria-hidden="true"
            style={{
                position: 'fixed', inset: 0, zIndex: -1,
                backgroundColor: colors.background,
                pointerEvents: 'none',
            }}
        >
            {/* A wash of colour so the corners are not flat black. Two offset
                radial gradients read as depth; one reads as a vignette. */}
            <div style={{
                position: 'absolute', inset: 0,
                background:
                    `radial-gradient(80% 55% at 12% -8%, rgba(58, 51, 22, 0.55) 0%, rgba(11,13,23,0) 60%),`
                    + `radial-gradient(70% 50% at 92% 8%, rgba(43, 52, 92, 0.5) 0%, rgba(11,13,23,0) 55%),`
                    + `radial-gradient(90% 60% at 50% 108%, rgba(30, 34, 53, 0.7) 0%, rgba(11,13,23,0) 70%)`,
            }} />

            <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            >
                {STARS.map((s, i) => (
                    <m.circle
                        key={i}
                        cx={s.x} cy={s.y} r={s.r}
                        fill={i % 9 === 0 ? brass.light : '#DCE3FF'}
                        initial={{ opacity: s.base }}
                        animate={still ? { opacity: s.base } : { opacity: [s.base, s.base * 1.9, s.base] }}
                        transition={still ? undefined : {
                            duration: s.period, delay: s.delay,
                            repeat: Infinity, ease: 'easeInOut',
                        }}
                    />
                ))}
            </svg>
        </div>
    );
}
