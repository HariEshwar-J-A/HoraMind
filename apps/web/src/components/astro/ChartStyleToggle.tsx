import { motion as m } from 'motion/react';
import { usePrefs, type ChartStyle } from '../../lib/prefs.js';
import { brass, colors, fonts, radius, space, touchTarget } from '../../theme/tokens.js';

/**
 * Switch between the two chart conventions.
 *
 * Both labels carry their region because "North" and "South" alone are
 * meaningless to anyone who has not already met both, and this control is most
 * useful to exactly that person — someone shown a chart in the convention they
 * do not read.
 *
 * The selected pill is a single element moved by `layoutId`, so it slides
 * between the two options rather than one fading out while another fades in.
 * The movement is what says these are two views of one thing rather than two
 * separate buttons.
 */

const OPTIONS: ReadonlyArray<{ value: ChartStyle; label: string; hint: string }> = [
    { value: 'north', label: 'North Indian', hint: 'houses fixed, signs rotate' },
    { value: 'south', label: 'South Indian', hint: 'signs fixed, ascendant marked' },
];

export function ChartStyleToggle() {
    const style = usePrefs(s => s.chartStyle);
    const setStyle = usePrefs(s => s.setChartStyle);
    const active = OPTIONS.find(o => o.value === style) ?? OPTIONS[0]!;

    return (
        <div style={{ marginBottom: space.md }}>
            <div
                role="radiogroup"
                aria-label="Chart convention"
                style={{
                    display: 'flex',
                    gap: space.xs,
                    padding: space.xs,
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.pill,
                }}
            >
                {OPTIONS.map(opt => {
                    const selected = opt.value === style;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setStyle(opt.value)}
                            style={{
                                position: 'relative',
                                flex: 1,
                                minHeight: touchTarget - 12,
                                border: 'none',
                                background: 'transparent',
                                borderRadius: radius.pill,
                                color: selected ? '#1A1503' : colors.textMuted,
                                fontSize: 13,
                                fontWeight: selected ? 600 : 400,
                                fontFamily: fonts.body,
                                cursor: 'pointer',
                                // Colour has to win over the sliding pill, which
                                // is painted underneath at a lower stacking level.
                                zIndex: 1,
                            }}
                        >
                            {selected && (
                                <m.span
                                    layoutId="hm-chart-style-pill"
                                    transition={{ type: 'spring', stiffness: 460, damping: 38 }}
                                    style={{
                                        position: 'absolute', inset: 0,
                                        backgroundColor: brass.mid,
                                        borderRadius: radius.pill,
                                        zIndex: -1,
                                    }}
                                />
                            )}
                            {opt.label}
                        </button>
                    );
                })}
            </div>

            <p style={{
                margin: 0, marginTop: space.xs,
                textAlign: 'center',
                fontSize: 11, lineHeight: '16px',
                color: colors.textFaint,
                fontFamily: fonts.mono,
            }}>
                {active.hint}
            </p>
        </div>
    );
}
