import { useQuery } from '@tanstack/react-query';
import type { Compass } from '@horamind/shared';
import { Screen, Card, Txt, Box, Notice } from '../components/primitives.js';
import { api } from '../lib/api.js';
import { colors, space } from '../theme/tokens.js';

/**
 * The daily compass.
 *
 * The basis is shown alongside the advice, collapsed but present. Guidance a
 * user cannot inspect is guidance they have to take on faith, and the whole
 * argument for this app is that it does not ask for faith.
 */
export function Today() {
    const { data, isLoading, error } = useQuery<Compass & { fromCache: boolean }>({
        queryKey: ['compass'],
        queryFn: () => api.get('/v1/compass'),
        // It is cached server-side by (chart, day) and cannot change within a
        // day, so refetching on every focus is pure waste.
        staleTime: 60 * 60 * 1000,
        retry: 1,
    });

    if (isLoading) return <Screen title="Today"><Txt style={{ color: colors.textMuted }}>Reading the sky…</Txt></Screen>;
    if (error || !data) {
        return (
            <Screen title="Today">
                <Notice tone="error">Could not load today&rsquo;s compass. Pull to refresh, or try later.</Notice>
            </Screen>
        );
    }

    return (
        <Screen title="Today">
            <Card style={{ borderColor: colors.accent }}>
                <Txt style={{ fontSize: 20, fontWeight: '600', lineHeight: 28 }}>{data.headline}</Txt>
                <Txt style={{ fontSize: 12, color: colors.textFaint, marginTop: space.sm }}>{data.date}</Txt>
            </Card>

            {data.dos.length > 0 && (
                <Card>
                    <SectionLabel colour={colors.benefic}>Favoured today</SectionLabel>
                    {data.dos.map((item, i) => <Bullet key={i} colour={colors.benefic}>{item}</Bullet>)}
                </Card>
            )}

            {data.donts.length > 0 && (
                <Card>
                    <SectionLabel colour={colors.malefic}>Better left for another day</SectionLabel>
                    {data.donts.map((item, i) => <Bullet key={i} colour={colors.malefic}>{item}</Bullet>)}
                </Card>
            )}

            {data.dos.length === 0 && data.donts.length === 0 && (
                <Notice tone="warn">
                    Guidance is unavailable right now, but the computed factors below are correct.
                </Notice>
            )}

            <details>
                <summary style={{
                    color: colors.textMuted, fontSize: 14, cursor: 'pointer',
                    padding: space.md, listStyle: 'none',
                }}>
                    Why — the factors behind this
                </summary>
                <Card style={{ marginTop: space.sm }}>
                    <Row label="Tithi" value={data.basis.tithi} />
                    <Row label="Nakshatra" value={data.basis.nakshatra} />
                    <Row label="Yoga" value={data.basis.yoga} />
                    <Row label="Karana" value={data.basis.karana} />
                    <Row label="Weekday" value={data.basis.vara} />
                    <Row label="Dasha" value={data.basis.currentDasha.join(' → ')} />
                    {data.basis.notableTransits.length > 0 && (
                        <Box style={{ marginTop: space.md }}>
                            <Txt style={{ fontSize: 12, color: colors.textMuted, marginBottom: space.xs }}>
                                Slow-moving transits
                            </Txt>
                            {data.basis.notableTransits.map((t, i) => (
                                <Txt key={i} style={{ fontSize: 13, color: colors.textFaint, lineHeight: 20 }}>{t}</Txt>
                            ))}
                        </Box>
                    )}
                </Card>
            </details>
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
