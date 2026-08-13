import { useQuery } from '@tanstack/react-query';
import { Screen, Card, Txt, Box, Notice } from '../components/primitives.js';
import { Reveal, Stagger, StaggerItem } from '../components/motion.js';
import { Shimmer } from '../components/ai.js';
import LoadingState from '../components/bui/LoadingState.js';
import { ChartWheel } from '../components/astro/ChartWheel.js';
import { SouthChart } from '../components/astro/SouthChart.js';
import { ChartStyleToggle } from '../components/astro/ChartStyleToggle.js';
import { NakshatraDial } from '../components/astro/NakshatraDial.js';
import { graha, natureColor } from '../components/astro/zodiac.js';
import { api } from '../lib/api.js';
import { usePrefs } from '../lib/prefs.js';
import { brass, colors, fonts, space, radius } from '../theme/tokens.js';

/**
 * The natal chart.
 *
 * The diagram the earlier version of this file asked for now exists: a North
 * Indian square in `components/astro/ChartWheel`, built from `react-native-svg`
 * -compatible primitives so the geometry survives a native port. The table
 * stays underneath it — the square is the recognisable form, but it cannot show
 * a degree, and a degree is what distinguishes a planet at the start of a sign
 * from one about to leave it.
 */

interface NatalResponse {
    ascendant: { signName: string; degree: number; sign: number };
    houseAccuracy: 'exact' | 'approximate' | 'unknown';
    planets: Array<{
        name: string; signName: string; degree: number;
        /** Sidereal longitude from 0° Aries — what the nakshatra dial needs. */
        longitude: number;
        house: number; retrograde: boolean;
    }>;
    meta: { ayanamsa: string; ayanamsaValue: number; engine: string };
}

export function Chart() {
    const chartStyle = usePrefs(s => s.chartStyle);
    const { data, isLoading, error } = useQuery<NatalResponse>({
        queryKey: ['natal'],
        queryFn: () => api.get('/v1/charts/natal'),
        // A birth chart is fixed for life. Refetching it is pointless.
        staleTime: Infinity,
    });

    if (isLoading) {
        return (
            <Screen title="Your chart">
                {/* Shaped like the answer: a square, then rows. Skeletons that
                    match the eventual layout stop the page jumping when it
                    arrives. */}
                <Box style={{ marginBottom: space.lg }}>
                    <LoadingState label="Computing your chart" variant="Orbit" />
                </Box>
                <Box style={{ display: 'flex', justifyContent: 'center', marginBottom: space.lg }}>
                    <Shimmer height={300} width={300} radius={radius.lg} />
                </Box>
                {[0, 1, 2, 3, 4].map(i => <Shimmer key={i} height={44} />)}
            </Screen>
        );
    }

    if (error || !data) {
        return <Screen title="Your chart"><Notice tone="error">Could not compute your chart.</Notice></Screen>;
    }

    const moon = data.planets.find(p => p.name === 'Moon');

    return (
        <Screen title="Your chart">
            {data.houseAccuracy !== 'exact' && (
                <Notice tone="warn">
                    Your birth time is {data.houseAccuracy}, so the ascendant and house positions
                    below are unreliable. Planetary positions and dashas are unaffected.
                </Notice>
            )}

            <ChartStyleToggle />

            {chartStyle === 'north' ? (
                <ChartWheel ascendantSign={data.ascendant.sign} planets={data.planets} />
            ) : (
                <SouthChart ascendantSign={data.ascendant.sign} planets={data.planets} />
            )}

            <Reveal delay={0.55}>
                <Card style={{ textAlign: 'center' }}>
                    <Txt style={{
                        fontSize: 12, color: colors.textMuted, letterSpacing: 1,
                        fontFamily: fonts.mono, marginBottom: space.xs,
                    }}>
                        ASCENDANT
                    </Txt>
                    <Txt style={{ fontSize: 26, fontWeight: '600', fontFamily: fonts.display, color: brass.light }}>
                        {data.ascendant.signName} {data.ascendant.degree.toFixed(2)}&deg;
                    </Txt>
                </Card>
            </Reveal>

            {moon && (
                <Reveal delay={0.7}>
                    <Card>
                        <Txt style={{
                            fontSize: 12, color: colors.textMuted, letterSpacing: 1,
                            fontFamily: fonts.mono, marginBottom: space.md, textAlign: 'center',
                        }}>
                            MOON&rsquo;S NAKSHATRA
                        </Txt>
                        <NakshatraDial moonLongitude={moon.longitude} />
                        <Txt style={{
                            fontSize: 12, color: colors.textFaint, textAlign: 'center',
                            marginTop: space.sm, lineHeight: 18,
                        }}>
                            This arc fixes your Vimshottari dasha sequence.
                        </Txt>
                    </Card>
                </Reveal>
            )}

            <Stagger delay={0.85}>
                <Card>
                    {data.planets.map(p => {
                        const g = graha(p.name);
                        return (
                            <StaggerItem key={p.name}>
                                <Box style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    paddingTop: space.md, paddingBottom: space.md,
                                    borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: colors.border,
                                }}>
                                    <Box style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
                                        <Txt as="span" style={{
                                            fontSize: 20, fontFamily: fonts.display,
                                            color: natureColor(g.nature), width: 24, textAlign: 'center',
                                        }}>
                                            {g.glyph}
                                        </Txt>
                                        <Box>
                                            <Txt style={{ fontSize: 16, fontWeight: '500' }}>{p.name}</Txt>
                                            <Txt style={{ fontSize: 11, color: colors.textFaint, fontFamily: fonts.display }}>
                                                {g.sanskrit}
                                            </Txt>
                                        </Box>
                                        {p.retrograde && (
                                            <Txt as="span" style={{
                                                fontSize: 11, color: colors.malefic,
                                                borderWidth: 1, borderStyle: 'solid', borderColor: colors.malefic,
                                                borderRadius: radius.sm, paddingLeft: 4, paddingRight: 4,
                                            }}>R</Txt>
                                        )}
                                    </Box>
                                    <Box style={{ textAlign: 'right' }}>
                                        <Txt style={{ fontSize: 14, fontFamily: fonts.mono }}>
                                            {p.signName} {p.degree.toFixed(2)}&deg;
                                        </Txt>
                                        <Txt style={{ fontSize: 12, color: colors.textFaint }}>House {p.house}</Txt>
                                    </Box>
                                </Box>
                            </StaggerItem>
                        );
                    })}
                </Card>
            </Stagger>

            <Reveal delay={1.15}>
                <Txt style={{
                    fontSize: 11, color: colors.textFaint, textAlign: 'center',
                    lineHeight: 18, fontFamily: fonts.mono,
                }}>
                    {data.meta.engine} · {data.meta.ayanamsa} ayanamsa
                    ({data.meta.ayanamsaValue.toFixed(4)}&deg;)
                </Txt>
            </Reveal>
        </Screen>
    );
}
