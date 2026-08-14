import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Compass } from '@horamind/shared';
import { Screen, Card, Txt, Box, Notice } from '../components/primitives.js';
import { Reveal, Stagger, StaggerItem } from '../components/motion.js';
import { DayStrip } from '../components/DayStrip.js';
import LoadingState from '../components/bui/LoadingState.js';
import { ErrorState, Accordion } from '@horamind/ui';
import { api } from '../lib/api.js';
import { brass, colors, fonts, radius, space } from '../theme/tokens.js';

/**
 * Today, and the fortnight around it.
 *
 * These were two tabs answering the same question — what is going on today —
 * with the reading in one place and the day it referred to in another. They are
 * one destination now: a strip of days across the top, and below it whatever
 * that day has to say.
 *
 * What "has to say" means depends on which day is chosen, and the difference is
 * deliberate rather than a limitation:
 *
 *   - **Today** gets the written compass. It is the only day worth spending a
 *     model call on, and the server caches it per day.
 *   - **Any other day** gets its computed facts only, and says so. Fifteen days
 *     of generated prose is fifteen paid completions for a screen most people
 *     scroll past, and a written "forecast" for next Tuesday would be a claim
 *     the app has no business making. Where a planet will be is arithmetic;
 *     what it means for someone is not.
 *
 * The basis is shown either way, collapsed but present. Guidance a user cannot
 * inspect is guidance they have to take on faith, and the whole argument for
 * this app is that it does not ask for faith.
 */

interface CalendarDay {
    date: string;
    relation: 'past' | 'today' | 'future';
    vara: string; tithi: string; nakshatra: string; yoga: string; karana: string;
    dasha: string[];
    transits: string[];
    mark: 'tender' | 'ordinary' | 'open';
    sunrise: string; sunset: string; hasRiseSet: boolean;
    windows: Array<{ name: string; from: string; to: string; kind: 'avoid' | 'favour'; note: string }>;
    horas: Array<{ lord: string; from: string; to: string; good: string; avoid: string; current?: boolean }>;
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

/**
 * Weekday from an ISO date, arithmetically.
 *
 * Never `new Date("2026-08-13").getDay()`: that parses as UTC midnight and
 * reports the previous day west of Greenwich — the same off-by-one this
 * codebase has already been bitten by twice, and it would be silent here.
 */
function dayLabel(iso: string): { weekday: string; day: string } {
    const [y, m, d] = iso.split('-').map(Number);
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    const yy = (m ?? 1) < 3 ? (y ?? 0) - 1 : (y ?? 0);
    const idx = (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400)
        + (t[(m ?? 1) - 1] ?? 0) + (d ?? 1)) % 7;
    return { weekday: WEEKDAYS[idx] ?? '', day: String(d ?? '') };
}

export function Today() {
    const [selected, setSelected] = useState<string | null>(null);

    const compass = useQuery<Compass & { fromCache: boolean }>({
        queryKey: ['compass'],
        queryFn: () => api.get('/v1/compass'),
        // Cached server-side by (chart, day) and cannot change within a day.
        staleTime: 60 * 60 * 1000,
        retry: 1,
    });

    const calendar = useQuery<{ days: CalendarDay[]; timezone: string; placeName: string }>({
        queryKey: ['calendar'],
        queryFn: () => api.get('/v1/calendar'),
        staleTime: 1000 * 60 * 30,
    });

    if (compass.isLoading && calendar.isLoading) {
        return <Screen title="Today"><LoadingState label="Reading the sky" variant="Orbit" /></Screen>;
    }

    const days = calendar.data?.days ?? [];
    const today = days.find(d => d.relation === 'today');
    const open = days.find(d => d.date === selected) ?? today;
    const isToday = open?.relation === 'today';

    return (
        <Screen title="Today">
            {days.length > 0 && open && (
                <Reveal>
                    <DayStrip activeKey={open.date}>
                        {days.map(d => {
                            const { weekday, day } = dayLabel(d.date);
                            const on = d.date === open.date;
                            return (
                                <Box
                                    key={d.date}
                                    active={on}
                                    onClick={() => setSelected(d.date)}
                                    style={{
                                        flex: '0 0 auto', width: 54,
                                        paddingTop: space.sm, paddingBottom: space.sm,
                                        textAlign: 'center', cursor: 'pointer',
                                        borderRadius: radius.md,
                                        borderWidth: 1, borderStyle: 'solid',
                                        borderColor: on ? brass.mid : colors.border,
                                        backgroundColor: on ? colors.surfaceRaised : colors.surface,
                                        // A day already lived reads dimmer, so the
                                        // strip runs forward at a glance.
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
            )}

            {/* Today: the written compass. */}
            {isToday && compass.data && (
                <Stagger>
                    <StaggerItem>
                        <Card style={{ borderColor: colors.accent }}>
                            <Txt style={{ fontSize: 20, fontWeight: '600', lineHeight: 28 }}>
                                {compass.data.headline}
                            </Txt>
                            <Txt style={{ fontSize: 12, color: colors.textFaint, marginTop: space.sm, fontFamily: fonts.mono }}>
                                {compass.data.date}
                            </Txt>
                        </Card>
                    </StaggerItem>

                    {compass.data.dos.length > 0 && (
                        <StaggerItem>
                            <Card>
                                <SectionLabel colour={colors.benefic}>Favoured today</SectionLabel>
                                {compass.data.dos.map((item, i) => (
                                    <Bullet key={i} colour={colors.benefic}>{item}</Bullet>
                                ))}
                            </Card>
                        </StaggerItem>
                    )}

                    {compass.data.donts.length > 0 && (
                        <StaggerItem>
                            <Card>
                                <SectionLabel colour={colors.malefic}>Better left for another day</SectionLabel>
                                {compass.data.donts.map((item, i) => (
                                    <Bullet key={i} colour={colors.malefic}>{item}</Bullet>
                                ))}
                            </Card>
                        </StaggerItem>
                    )}
                </Stagger>
            )}

            {isToday && compass.isError && (
                <Notice tone="warn">
                    Guidance is unavailable right now, but the computed factors below are correct.
                </Notice>
            )}

            {/* Any other day: the facts, and an honest label. */}
            {open && !isToday && (
                <Reveal delay={0.05}>
                    <Card style={{ borderColor: brass.deep }}>
                        <Box style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'baseline', marginBottom: space.sm,
                        }}>
                            <Txt style={{ fontSize: 20, fontFamily: fonts.display, color: brass.light }}>
                                {open.date}
                            </Txt>
                            <Txt style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textFaint }}>
                                {open.relation === 'future' ? 'TRANSITS AHEAD' : 'ALREADY PASSED'}
                            </Txt>
                        </Box>
                        <Txt style={{ fontSize: 13, color: MARK_COLOR[open.mark], lineHeight: 19 }}>
                            {MARK_LABEL[open.mark]}
                        </Txt>
                        <Txt style={{
                            fontSize: 12, color: colors.textFaint, lineHeight: 18,
                            marginTop: space.sm,
                        }}>
                            {open.relation === 'future'
                                ? 'Computed positions for that day. Nothing here is a forecast — a reading is only written for today.'
                                : 'Computed positions for that day, so you can check them against what actually happened.'}
                        </Txt>
                    </Card>
                </Reveal>
            )}

            {/* Right now — the single most day-to-day useful thing here. */}
            {open?.horas?.find(h => h.current) && (
                <Reveal delay={0.08}>
                    <Card style={{ borderColor: brass.deep }}>
                        <Txt style={{
                            fontSize: 11, color: colors.textMuted, letterSpacing: 1,
                            fontFamily: fonts.mono, marginBottom: space.sm,
                        }}>
                            RIGHT NOW
                        </Txt>
                        {(() => {
                            const h = open.horas.find(x => x.current)!;
                            return (
                                <>
                                    <Txt style={{ fontSize: 17, fontFamily: fonts.display, color: brass.light }}>
                                        {h.lord} hora · {h.from}&ndash;{h.to}
                                    </Txt>
                                    <Txt style={{ fontSize: 14, lineHeight: 21, marginTop: space.sm }}>
                                        Good for: {h.good}
                                    </Txt>
                                    <Txt style={{ fontSize: 13, color: colors.textMuted, lineHeight: 20, marginTop: space.xs }}>
                                        Hold off on: {h.avoid}
                                    </Txt>
                                </>
                            );
                        })()}
                    </Card>
                </Reveal>
            )}

            {/* Windows to use and windows to avoid. */}
            {open && open.windows.length > 0 && (
                <Reveal delay={0.1}>
                    <Card>
                        <Box style={{
                            display: 'flex', justifyContent: 'space-between',
                            marginBottom: space.md,
                        }}>
                            <Txt style={{
                                fontSize: 11, color: colors.textMuted, letterSpacing: 1,
                                fontFamily: fonts.mono,
                            }}>
                                TIMES THAT DAY
                            </Txt>
                            <Txt style={{ fontSize: 11, color: colors.textFaint, fontFamily: fonts.mono }}>
                                {open.sunrise} &ndash; {open.sunset}
                            </Txt>
                        </Box>

                        {/* Which place these are for. Every window here is a
                            division of daylight, so it is only right for one
                            location — and the app knows the birth place, not
                            where the reader is standing. Saying so is cheaper
                            than being quietly wrong for anyone who moved. */}
                        <Txt style={{
                            fontSize: 11, color: colors.textFaint,
                            marginBottom: space.md, lineHeight: 17,
                        }}>
                            Sunrise to sunset at {calendar.data?.placeName}. If you are
                            elsewhere today, these shift with your local sunrise.
                        </Txt>

                        {!open.hasRiseSet && (
                            <Txt style={{ fontSize: 12, color: colors.textFaint, marginBottom: space.sm, lineHeight: 18 }}>
                                The sun does not rise or set at your latitude on this date, so these
                                windows are shown against a nominal day.
                            </Txt>
                        )}

                        {/* Favourable first: someone opening this wants to know
                            when they can act, not only when they cannot. */}
                        {[...open.windows].sort(a => (a.kind === 'favour' ? -1 : 1)).map(w => (
                            <Box key={w.name} style={{
                                paddingTop: space.md, paddingBottom: space.md,
                                borderBottomWidth: 1, borderBottomStyle: 'solid',
                                borderBottomColor: colors.border,
                            }}>
                                <Box style={{
                                    display: 'flex', justifyContent: 'space-between',
                                    alignItems: 'baseline', gap: space.md,
                                }}>
                                    <Txt style={{
                                        fontSize: 15,
                                        color: w.kind === 'favour' ? colors.benefic : colors.malefic,
                                    }}>
                                        {w.name}
                                    </Txt>
                                    <Txt style={{ fontSize: 14, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
                                        {w.from}&ndash;{w.to}
                                    </Txt>
                                </Box>
                                <Txt style={{
                                    fontSize: 12, color: colors.textFaint,
                                    lineHeight: 18, marginTop: space.xs,
                                }}>
                                    {w.note}
                                </Txt>
                            </Box>
                        ))}
                    </Card>
                </Reveal>
            )}

            {/* The full hora table, folded away. */}
            {open && open.horas.length > 0 && (
                <Reveal delay={0.12}>
                    <Accordion title="Hour by hour — what each part of the day suits">
                        <Card style={{ marginTop: space.sm }}>
                            {open.horas.map((h, i) => (
                                <Box key={i} style={{
                                    display: 'flex', gap: space.md,
                                    paddingTop: space.sm, paddingBottom: space.sm,
                                    borderBottomWidth: 1, borderBottomStyle: 'solid',
                                    borderBottomColor: colors.border,
                                    backgroundColor: h.current ? colors.surfaceRaised : 'transparent',
                                }}>
                                    <Txt style={{
                                        fontSize: 12, fontFamily: fonts.mono,
                                        color: colors.textFaint, width: 84, flexShrink: 0,
                                    }}>
                                        {h.from}&ndash;{h.to}
                                    </Txt>
                                    <Box style={{ minWidth: 0 }}>
                                        <Txt style={{
                                            fontSize: 13,
                                            color: h.current ? brass.light : colors.text,
                                        }}>
                                            {h.lord}
                                        </Txt>
                                        <Txt style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                                            {h.good}
                                        </Txt>
                                    </Box>
                                </Box>
                            ))}
                        </Card>
                    </Accordion>
                </Reveal>
            )}

            {/* The basis, for whichever day is open. */}
            {open && (
                <Reveal delay={0.1}>
                    <Accordion title="Why — the factors behind this">
                        <Card>
                            <Row label="Tithi" value={open.tithi} />
                            <Row label="Nakshatra" value={open.nakshatra} />
                            <Row label="Yoga" value={open.yoga} />
                            <Row label="Karana" value={open.karana} />
                            <Row label="Weekday" value={open.vara} />
                            <Row label="Dasha" value={open.dasha.join(' → ')} />
                            {open.transits.length > 0 && (
                                <Box style={{ marginTop: space.md }}>
                                    <Txt style={{ fontSize: 12, color: colors.textMuted, marginBottom: space.xs }}>
                                        Slow-moving transits
                                    </Txt>
                                    {open.transits.map((tr, i) => (
                                        <Txt key={i} style={{ fontSize: 13, color: colors.textFaint, lineHeight: 20 }}>
                                            {tr}
                                        </Txt>
                                    ))}
                                </Box>
                            )}
                        </Card>
                    </Accordion>
                </Reveal>
            )}

            {calendar.isError && !compass.data && (
                <ErrorState
                    title="Could not load today"
                    hint="The calendar is computed, not generated — a retry is cheap."
                    onRetry={() => { void calendar.refetch(); void compass.refetch(); }}
                />
            )}
        </Screen>
    );
}

function SectionLabel({ children, colour }: { children: string; colour: string }) {
    return (
        <Txt style={{
            fontSize: 12, fontWeight: '600', color: colour,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: space.md,
        }}>
            {children}
        </Txt>
    );
}

function Bullet({ children, colour }: { children: string; colour: string }) {
    return (
        <Box style={{ display: 'flex', gap: space.md, marginBottom: space.md }}>
            <Box style={{
                width: 6, height: 6, borderRadius: 3, backgroundColor: colour,
                marginTop: 9, flexShrink: 0,
            }} />
            <Txt style={{ fontSize: 15, lineHeight: 22 }}>{children}</Txt>
        </Box>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <Box style={{
            display: 'flex', justifyContent: 'space-between',
            paddingTop: space.sm, paddingBottom: space.sm, gap: space.md,
        }}>
            <Txt style={{ fontSize: 13, color: colors.textMuted }}>{label}</Txt>
            <Txt style={{ fontSize: 13, textAlign: 'right' }}>{value}</Txt>
        </Box>
    );
}
