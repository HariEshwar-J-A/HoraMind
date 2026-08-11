import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Screen, Card, Button, Txt, Box, Notice } from '../components/primitives.js';
import { api, ApiError } from '../lib/api.js';
import { colors, space, radius, touchTarget } from '../theme/tokens.js';

/**
 * Ask a question.
 *
 * The dasha stack and citations are shown with the answer rather than hidden
 * behind a disclosure. An interpretation that names the periods it rests on and
 * the verses it cites can be checked; one that does not is indistinguishable
 * from a language model improvising, which is the thing this whole system
 * exists to avoid.
 */

interface InterpretResponse {
    answer: string;
    citations: Array<{ source: string | null; chapter: number | null; verse: string | null }>;
    dashaStack: Array<{
        levelName: string; lord: string;
        houseFromLordAbove: number | null; classicalBranch: string | null;
    }>;
    quota: { used: number; limit: number; remaining: number };
}

export function Ask() {
    const [question, setQuestion] = useState('');
    const [result, setResult] = useState<InterpretResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const ask = useMutation({
        mutationFn: (q: string) => api.post<InterpretResponse>('/v1/interpret', { question: q }),
        onSuccess: data => { setResult(data); setError(null); },
        onError: (err: unknown) => {
            setError(err instanceof ApiError
                ? (err.isQuota
                    ? 'You have used today\'s questions. They reset at midnight your time.'
                    : err.message)
                : 'Something went wrong.');
        },
    });

    return (
        <Screen title="Ask">
            <Card>
                <textarea
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    placeholder="What should I focus on at work this year?"
                    rows={4}
                    style={{
                        width: '100%',
                        padding: space.md,
                        backgroundColor: colors.background,
                        color: colors.text,
                        border: `1px solid ${colors.border}`,
                        borderRadius: radius.md,
                        // 16px or iOS Safari zooms the viewport on focus.
                        fontSize: 16,
                        lineHeight: '24px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                        minHeight: touchTarget * 2,
                    }}
                />
                <Button
                    style={{ marginTop: space.md }}
                    label={ask.isPending ? 'Consulting the chart…' : 'Ask'}
                    onPress={() => ask.mutate(question)}
                    disabled={ask.isPending || question.trim().length < 3}
                />
            </Card>

            {error && <Notice tone="error">{error}</Notice>}

            {result && (
                <>
                    <Card>
                        {result.answer.split('\n').filter(Boolean).map((para, i) => (
                            <Txt key={i} style={{ fontSize: 16, lineHeight: 25, marginBottom: space.md }}>
                                {para}
                            </Txt>
                        ))}
                    </Card>

                    <Card>
                        <Txt style={{
                            fontSize: 12, fontWeight: '600', color: colors.textMuted,
                            textTransform: 'uppercase', letterSpacing: 1, marginBottom: space.md,
                        }}>
                            Periods this rests on
                        </Txt>
                        {result.dashaStack.map((d, i) => (
                            <Box key={i} style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'center', paddingTop: space.sm, paddingBottom: space.sm,
                            }}>
                                <Box>
                                    <Txt style={{ fontSize: 14 }}>{d.lord}</Txt>
                                    <Txt style={{ fontSize: 12, color: colors.textFaint }}>{d.levelName}</Txt>
                                </Box>
                                {d.classicalBranch && (
                                    <Txt style={{
                                        fontSize: 12,
                                        color: d.classicalBranch === 'adverse' ? colors.malefic
                                             : d.classicalBranch === 'favourable' ? colors.benefic
                                             : colors.neutral,
                                    }}>
                                        {/* The house distance is what selects the branch of a
                                            classical verse; showing it makes the reasoning
                                            checkable rather than asserted. */}
                                        {d.classicalBranch}
                                        {d.houseFromLordAbove !== null && ` · ${d.houseFromLordAbove}th from lord`}
                                    </Txt>
                                )}
                            </Box>
                        ))}
                    </Card>

                    {result.citations.length > 0 && (
                        <Card>
                            <Txt style={{
                                fontSize: 12, fontWeight: '600', color: colors.textMuted,
                                textTransform: 'uppercase', letterSpacing: 1, marginBottom: space.md,
                            }}>
                                Sources consulted
                            </Txt>
                            {result.citations.map((c, i) => (
                                <Txt key={i} style={{ fontSize: 13, color: colors.textFaint, lineHeight: 20 }}>
                                    {[c.source ?? 'BPHS',
                                      c.chapter ? `Chapter ${c.chapter}` : null,
                                      c.verse ? `verse ${c.verse}` : null,
                                    ].filter(Boolean).join(' · ')}
                                </Txt>
                            ))}
                        </Card>
                    )}

                    <Txt style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
                        {result.quota.remaining} of {result.quota.limit} questions left today
                    </Txt>
                </>
            )}
        </Screen>
    );
}
