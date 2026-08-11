import { useQuery } from '@tanstack/react-query';
import { Screen, Card, Txt, Box, Notice } from '../components/primitives.js';
import { api } from '../lib/api.js';
import { colors, space, radius } from '../theme/tokens.js';

/**
 * The natal chart.
 *
 * Rendered as a table rather than a diagram for now. A North or South Indian
 * square chart is the recognisable form and belongs here, but it is a real
 * piece of SVG work — and a legible table of placements is more useful than a
 * half-drawn diagram. When it arrives it should use `react-native-svg`
 * primitives so the geometry survives a native port.
 */

interface NatalResponse {
    ascendant: { signName: string; degree: number; sign: number };
    houseAccuracy: 'exact' | 'approximate' | 'unknown';
    planets: Array<{
        name: string; signName: string; degree: number;
        house: number; retrograde: boolean;
    }>;
    meta: { ayanamsa: string; ayanamsaValue: number; engine: string };
}

export function Chart() {
    const { data, isLoading, error } = useQuery<NatalResponse>({
        queryKey: ['natal'],
        queryFn: () => api.get('/v1/charts/natal'),
        // A birth chart is fixed for life. Refetching it is pointless.
        staleTime: Infinity,
    });

    if (isLoading) return <Screen title="Your chart"><Txt style={{ color: colors.textMuted }}>Computing…</Txt></Screen>;
    if (error || !data) {
        return <Screen title="Your chart"><Notice tone="error">Could not compute your chart.</Notice></Screen>;
    }

    return (
        <Screen title="Your chart">
            {data.houseAccuracy !== 'exact' && (
                <Notice tone="warn">
                    Your birth time is {data.houseAccuracy}, so the ascendant and house positions
                    below are unreliable. Planetary positions and dashas are unaffected.
                </Notice>
            )}

            <Card>
                <Txt style={{ fontSize: 12, color: colors.textMuted, marginBottom: space.xs }}>Ascendant</Txt>
                <Txt style={{ fontSize: 24, fontWeight: '600' }}>
                    {data.ascendant.signName} {data.ascendant.degree.toFixed(2)}&deg;
                </Txt>
            </Card>

            <Card>
                {data.planets.map(p => (
                    <Box key={p.name} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        paddingTop: space.md, paddingBottom: space.md,
                        borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: colors.border,
                    }}>
                        <Box style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
                            <Txt style={{ fontSize: 16, fontWeight: '500' }}>{p.name}</Txt>
                            {p.retrograde && (
                                <Txt as="span" style={{
                                    fontSize: 11, color: colors.malefic,
                                    borderWidth: 1, borderStyle: 'solid', borderColor: colors.malefic,
                                    borderRadius: radius.sm, paddingLeft: 4, paddingRight: 4,
                                }}>R</Txt>
                            )}
                        </Box>
                        <Box style={{ textAlign: 'right' }}>
                            <Txt style={{ fontSize: 14 }}>
                                {p.signName} {p.degree.toFixed(2)}&deg;
                            </Txt>
                            <Txt style={{ fontSize: 12, color: colors.textFaint }}>House {p.house}</Txt>
                        </Box>
                    </Box>
                ))}
            </Card>

            <Txt style={{ fontSize: 11, color: colors.textFaint, textAlign: 'center', lineHeight: 18 }}>
                {data.meta.engine} · {data.meta.ayanamsa} ayanamsa
                ({data.meta.ayanamsaValue.toFixed(4)}&deg;)
            </Txt>
        </Screen>
    );
}
