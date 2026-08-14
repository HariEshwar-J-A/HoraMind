import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Screen, Card, Txt, Box, Notice } from '../components/primitives.js';
import { Reveal, Stagger, StaggerItem } from '../components/motion.js';
import { DayStrip } from '../components/DayStrip.js';
import LoadingState from '../components/bui/LoadingState.js';
import { api } from '../lib/api.js';
import { brass, colors, fonts, radius, space } from '../theme/tokens.js';

/**
 * A week either side of today.
 *
 * Everything here is computed, not written: the endpoint calls no model. That
 * shows in the copy as well as the cost — days ahead are labelled *transits*,
 * never forecasts, because where a planet will be is arithmetic and what it
 * means for someone is not. The day behind carries the same facts, which is
 * what makes the strip worth scrolling: it lets someone check a claim against
 * a week they actually lived.
 */

interface CalendarDay {
    date: string;
    relation: 'past' | 'today' | 'future';
    vara: string; tithi: string; nakshatra: string; yoga: string; karana: string;
    dasha: string[];
    transits: string[];
    mark: 'tender' | 'ordinary' | 'open';
}

const MARK_COLOR: Record<CalendarDay['mark'], string> = {
    tender: colors.malefic,
    ordinary: colors.textFaint,
    open: colors.benefic,
};

const MARK_LABEL: Record<CalendarDay['mark'], string> = {
    tender: 'A rikta tithi — classically poor for starting something new',
    ordinary: 'An ordinary tithi, with no particular reputation',
    open: 'A purna tithi — classically a complete, favourable day',
};

/** "2026-08-13" without constructing a Date, which would shift it by a zone. */
function dayLabel(iso: string): { weekday: string; day: string } {
    const [y, m, d] = iso.split('-').map(Number);
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // Zeller-style index from the civil date itself. Building a Date from the
    // string and reading getDay() would re-introduce exactly the UTC-midnight
    // off-by-one that this codebase has already been bitten by once.
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    const yy = (m ?? 1) < 3 ? (y ?? 0) - 1 : (y ?? 0);
    const idx = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400)
        + (t[(m ?? 1) - 1] ?? 0) + (d ?? 1)) % 7;
    return { weekday: WEEKDAYS[idx] ?? '', day: String(d ?? '') };
}

export function Calendar() {
    const [selected, setSelected] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery<{ days: CalendarDay[]; timezone: string }>({
        queryKey: ['calendar'],
        queryFn: () => api.get('/v1/calendar'),
        // The panchanga for a given day never changes. Only the definition of
        // "today" does, and that is a reload away.
        staleTime: 1000 * 60 * 30,
    });

    if (isLoading) {
        return (
            <Screen title="Calendar">
                <LoadingState label="Computing the week" variant="Dots" />
            </Screen>
        );
    }
    if (error || !data) {
        return <Screen title="Calendar"><Notice tone="error">Could not compute the calendar.</Notice></Screen>;
    }

    const today = data.days.find(d => d.relation === 'today');
    const open = data.days.find(d => d.date === selected) ?? today ?? data.days[0]!;

    return (
        <Screen title="Calendar">
            <Reveal>
                <DayStrip activeKey={open.date}>
                    {data.days.map(d => {
                        const { weekday, day } = dayLabel(d.date);
                        const isOpen = d.date === open.date;
                        return (
                            <Box
                                key={d.date}
                                active={isOpen}
                                onClick={() => setSelected(d.date)}
                                style={{
                                    flex: '0 0 auto', width: 54,
                                    paddingTop: space.sm, paddingBottom: space.sm,
                                    textAlign: 'center', cursor: 'pointer',
                                    borderRadius: radius.md,
                                    borderWidth: 1, borderStyle: 'solid',
                                    borderColor: isOpen ? brass.mid : colors.border,
                                    backgroundColor: isOpen ? colors.surfaceRaised : colors.surface,
                                    // A day already lived is dimmer than one ahead;
                                    // the strip should read forward at a glance.
                                    opacity: d.relation === 'past' ? 0.62 : 1,
                                }}
                            >
                                <Txt style={{ fontSize: 10, color: colors.textFaint, fontFamily: fonts.mono }}>
                                    {weekday}
                                </Txt>
                                <Txt style={{
                                    fontSize: 18, fontFamily: fonts.display,
                                    color: d.relation === 'today' ? brass.light : colors.text,
                                }}>
                                    {day}
                                </Txt>
                                <Box style={{
                                    width: 5, height: 5, borderRadius: radius.pill,
                                    backgroundColor: MARK_COLOR[d.mark],
                                    marginLeft: 'auto', marginRight: 'auto', marginTop: 3,
                                }} />
                            </Box>
                        );
                    })}
                </DayStrip>
            </Reveal>

            <Stagger>
                <StaggerItem>
                    <Card>
                        <Box style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline', marginBottom: space.md,
                        }}>
                            <Txt style={{ fontSize: 20, fontFamily: fonts.display, color: brass.light }}>
                                {open.date}
                            </Txt>
                            <Txt style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textFaint }}>
                                {open.relation === 'future' ? 'TRANSITS AHEAD'
                                    : open.relation === 'past' ? 'ALREADY PASSED' : 'TODAY'}
                            </Txt>
                        </Box>

                        <Txt style={{
                            fontSize: 13, color: MARK_COLOR[open.mark],
                            lineHeight: 19, marginBottom: space.md,
                        }}>
                            {MARK_LABEL[open.mark]}
                        </Txt>

                        {([
                            ['Weekday', open.vara], ['Tithi', open.tithi],
                            ['Nakshatra', open.nakshatra], ['Yoga', open.yoga],
                            ['Karana', open.karana],
                        ] as const).map(([label, value]) => (
                            <Box key={label} style={{
                                display: 'flex', justifyContent: 'space-between',
                                paddingTop: space.sm, paddingBottom: space.sm,
                                borderBottomWidth: 1, borderBottomStyle: 'solid',
                                borderBottomColor: colors.border,
                            }}>
                                <Txt style={{ fontSize: 13, color: colors.textMuted }}>{label}</Txt>
                                <Txt style={{ fontSize: 13, fontFamily: fonts.mono }}>{value}</Txt>
                            </Box>
                        ))}
                    </Card>
                </StaggerItem>

                {open.transits.length > 0 && (
                    <StaggerItem>
                        <Card>
                            <Txt style={{
                                fontSize: 12, color: colors.textMuted, letterSpacing: 1,
                                fontFamily: fonts.mono, marginBottom: space.sm,
                            }}>
                                SLOW-MOVING TRANSITS
                            </Txt>
                            {open.transits.map((t, i) => (
                                <Txt key={i} style={{
                                    fontSize: 13, color: colors.textMuted, lineHeight: 20,
                                }}>
                                    {t}
                                </Txt>
                            ))}
                        </Card>
                    </StaggerItem>
                )}

                <StaggerItem>
                    <Txt style={{
                        fontSize: 11, color: colors.textFaint, textAlign: 'center',
                        lineHeight: 17, fontFamily: fonts.mono,
                    }}>
                        Computed from the ephemeris. No interpretation was generated for these days.
                    </Txt>
                </StaggerItem>
            </Stagger>
        </Screen>
    );
}
