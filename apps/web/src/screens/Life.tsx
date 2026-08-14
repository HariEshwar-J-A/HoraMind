import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Txt, Notice } from '../components/primitives.js';
import { Reveal, Stagger, StaggerItem } from '../components/motion.js';
import LoadingState from '../components/bui/LoadingState.js';
import { ErrorState } from '@horamind/ui';
import { api, ApiError } from '../lib/api.js';
import { brass, colors, fonts, space } from '../theme/tokens.js';

/**
 * The long reading.
 *
 * Generated only when asked for, and never silently: it is five completions
 * over the whole chart, so the button says what it will do and the screen says
 * when the stored copy was written. A reading that refreshed itself on open
 * would spend a user's credit for the privilege of showing them the same words.
 *
 * Staleness is surfaced rather than acted on. The server knows the memories and
 * interests behind the stored copy have changed, but whether that is worth
 * regenerating is the reader's call, not the app's.
 */

interface Section { key: string; title: string; body: string }

interface LifeAnalysis {
    status: 'none' | 'ready';
    sections: Section[];
    stale: boolean;
    generatedAt: string | null;
    model: string | null;
}

export function Life() {
    const qc = useQueryClient();

    const { data, isLoading } = useQuery<LifeAnalysis>({
        queryKey: ['life'],
        queryFn: () => api.get('/v1/life-analysis'),
        staleTime: 1000 * 60 * 10,
    });

    const generate = useMutation({
        mutationFn: () => api.post<LifeAnalysis>('/v1/life-analysis', {}),
        onSuccess: fresh => qc.setQueryData(['life'], fresh),
    });

    if (isLoading) {
        return <Screen title="Your life"><LoadingState label="Loading" variant="Dots" /></Screen>;
    }

    const has = data?.status === 'ready' && data.sections.length > 0;

    return (
        <Screen title="Your life">
            {generate.isPending && (
                <Card>
                    <LoadingState label="Writing your reading" variant="Orbit" />
                    <Txt style={{
                        fontSize: 12, color: colors.textFaint, marginTop: space.sm, lineHeight: 18,
                    }}>
                        Five sections, each written from the chart, your memories and your
                        interests. This takes a minute.
                    </Txt>
                </Card>
            )}

            {generate.isError && (
                <ErrorState
                    title={generate.error instanceof ApiError ? generate.error.message : 'Could not write the reading.'}
                    hint="Five completions; a retry spends them again."
                    onRetry={() => generate.mutate()}
                />
            )}

            {!has && !generate.isPending && (
                <Reveal>
                    <Card>
                        <Txt style={{ fontSize: 16, lineHeight: 25, marginBottom: space.md }}>
                            A long reading of the whole chart — temperament, work, relationships,
                            the periods ahead, and what to work on. It draws on the memories and
                            interests you have saved, so it is worth adding a few first.
                        </Txt>
                        <Button
                            label="Write my reading"
                            onPress={() => generate.mutate()}
                            disabled={generate.isPending}
                        />
                    </Card>
                </Reveal>
            )}

            {has && (
                <Stagger>
                    {data.stale && (
                        <StaggerItem>
                            <Notice tone="warn">
                                Your memories or interests have changed since this was written.
                                It is still accurate about the chart — only the parts that read
                                your own material are out of date.
                            </Notice>
                        </StaggerItem>
                    )}

                    {data.sections.map(s => (
                        <StaggerItem key={s.key}>
                            <Card>
                                <Txt style={{
                                    fontSize: 12, color: colors.textMuted, letterSpacing: 1,
                                    fontFamily: fonts.mono, marginBottom: space.sm,
                                }}>
                                    {s.title.toUpperCase()}
                                </Txt>
                                {s.body.split('\n').filter(Boolean).map((para, i) => (
                                    <Txt key={i} style={{
                                        fontSize: 16, lineHeight: 26, marginBottom: space.sm,
                                    }}>
                                        {para}
                                    </Txt>
                                ))}
                            </Card>
                        </StaggerItem>
                    ))}

                    <StaggerItem>
                        <Card>
                            <Txt style={{
                                fontSize: 12, color: colors.textFaint,
                                fontFamily: fonts.mono, marginBottom: space.md,
                            }}>
                                Written {data.generatedAt?.slice(0, 10) ?? 'recently'}
                            </Txt>
                            <Button
                                label={data.stale ? 'Rewrite with what has changed' : 'Rewrite'}
                                variant={data.stale ? 'primary' : 'secondary'}
                                onPress={() => generate.mutate()}
                                disabled={generate.isPending}
                            />
                        </Card>
                    </StaggerItem>

                    <StaggerItem>
                        <Txt style={{
                            fontSize: 11, color: brass.deep, textAlign: 'center',
                            lineHeight: 17, fontFamily: fonts.mono,
                        }}>
                            A description, not a prediction.
                        </Txt>
                    </StaggerItem>
                </Stagger>
            )}
        </Screen>
    );
}
