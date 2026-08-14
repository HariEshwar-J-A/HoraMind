/**
 * Antara tokens.
 *
 * Extracted so layout/controls/feedback can import them without cycling
 * through the barrel. The barrel re-exports these.
 */

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

export const spring = { type: 'spring' as const, stiffness: 380, damping: 32 };
export const springSoft = { type: 'spring' as const, stiffness: 210, damping: 26 };
