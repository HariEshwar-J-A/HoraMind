import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Memory, Interest, InterestPromptState } from '@horamind/shared';
import { Screen, Card, Button, Field, Txt, Box, Notice } from '../components/primitives.js';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { colors, space } from '../theme/tokens.js';

/**
 * Memories, interests and account.
 *
 * The weekly interest prompt appears here as an inline card rather than a modal
 * overlay. A modal that blocks the app on launch to ask a question the user did
 * not initiate is the most reliable way to make them dismiss it forever without
 * reading it.
 */
export function You() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { user, signOut } = useSession();

    const memories = useQuery<{ memories: Memory[]; used: number; limit: number }>({
        queryKey: ['memories'], queryFn: () => api.get('/v1/memories'),
    });

    const prompt = useQuery<InterestPromptState>({
        queryKey: ['interest-prompt'], queryFn: () => api.get('/v1/interests/prompt'),
    });

    const [draft, setDraft] = useState('');
    const [learnt, setLearnt] = useState('');

    const addMemory = useMutation({
        mutationFn: () => api.post('/v1/memories', {
            whatHappened: draft,
            whatILearnt: learnt || null,
            occurredOn: null,
        }),
        onSuccess: () => {
            setDraft(''); setLearnt('');
            void qc.invalidateQueries({ queryKey: ['memories'] });
        },
    });

    const respondToPrompt = useMutation({
        mutationFn: (body: { action: 'answer' | 'skip' | 'never'; interests?: Array<{ label: string; weight: number }> }) =>
            api.post('/v1/interests/prompt', body),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['interest-prompt'] }),
    });

    const [interestDraft, setInterestDraft] = useState('');

    const atLimit = (memories.data?.used ?? 0) >= (memories.data?.limit ?? 30);

    return (
        <Screen title="You">
            {prompt.data?.due && (
                <Card style={{ borderColor: colors.accent }}>
                    <Txt style={{ fontSize: 17, fontWeight: '600', marginBottom: space.sm }}>
                        What&rsquo;s on your mind lately?
                    </Txt>
                    <Txt style={{ fontSize: 14, color: colors.textMuted, marginBottom: space.md }}>
                        Up to {prompt.data.remainingSlots + prompt.data.current.length} things you
                        care about. Readings will lead with these.
                    </Txt>
                    <Field
                        label="Comma separated" value={interestDraft} onChange={setInterestDraft}
                        placeholder="career, health, relationship"
                    />
                    <Button
                        label="Save"
                        onPress={() => respondToPrompt.mutate({
                            action: 'answer',
                            interests: interestDraft.split(',')
                                .map(s => s.trim()).filter(Boolean)
                                .map(label => ({ label, weight: 1 })),
                        })}
                        disabled={!interestDraft.trim()}
                    />
                    <Box style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
                        <Button variant="ghost" label="Not now"
                                onPress={() => respondToPrompt.mutate({ action: 'skip' })} />
                        <Button variant="ghost" label="Don't ask again"
                                onPress={() => respondToPrompt.mutate({ action: 'never' })} />
                    </Box>
                </Card>
            )}

            {prompt.data && prompt.data.current.length > 0 && (
                <Card>
                    <Label>Your interests</Label>
                    <Box style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm }}>
                        {prompt.data.current.map((i: Interest) => (
                            <Txt key={i.id} as="span" style={{
                                fontSize: 13, paddingTop: 6, paddingBottom: 6,
                                paddingLeft: space.md, paddingRight: space.md,
                                backgroundColor: colors.surfaceRaised, borderRadius: 999,
                            }}>{i.label}</Txt>
                        ))}
                    </Box>
                </Card>
            )}

            <Card>
                <Label>Add a memory</Label>
                <Txt style={{ fontSize: 13, color: colors.textMuted, marginBottom: space.md }}>
                    Something that happened and what it taught you. Readings use these to
                    calibrate — nothing else you type is remembered.
                </Txt>
                <Field label="What happened" value={draft} onChange={setDraft}
                       placeholder="Changed jobs after a long deliberation" />
                <Field label="What you learnt (optional)" value={learnt} onChange={setLearnt}
                       placeholder="I need a runway before I leap" />
                {atLimit
                    ? <Notice tone="warn">
                          You have {memories.data?.limit} memories saved, which is the maximum.
                          Delete one to add another.
                      </Notice>
                    : <Button label="Save memory" onPress={() => addMemory.mutate()}
                              disabled={draft.trim().length < 1 || addMemory.isPending} />}
            </Card>

            {memories.data && memories.data.memories.length > 0 && (
                <Card>
                    <Label>Saved memories · {memories.data.used} of {memories.data.limit}</Label>
                    {memories.data.memories.map(m => (
                        <Box key={m.id} style={{ paddingTop: space.md, paddingBottom: space.md }}>
                            <Txt style={{ fontSize: 15 }}>{m.whatHappened}</Txt>
                            {m.whatILearnt && (
                                <Txt style={{ fontSize: 13, color: colors.textMuted, marginTop: space.xs }}>
                                    → {m.whatILearnt}
                                </Txt>
                            )}
                        </Box>
                    ))}
                </Card>
            )}

            <Card>
                <Label>Account</Label>
                <Txt style={{ fontSize: 14, color: colors.textMuted, marginBottom: space.md }}>
                    {user?.email} · ID {user?.publicId}
                </Txt>
                <Button
                    variant="secondary"
                    label="Edit your birth details"
                    onPress={() => navigate('/you/details')}
                    style={{ marginBottom: space.sm }}
                />
                <Button
                    variant="secondary"
                    label="Your life — the long reading"
                    onPress={() => navigate('/you/life')}
                    style={{ marginBottom: space.sm }}
                />
                <Button variant="secondary" label="Signed-in devices"
                        onPress={() => navigate('/you/devices')} />
                <Button variant="ghost" style={{ marginTop: space.sm }} label="Sign out"
                        onPress={() => void signOut().then(() => navigate('/sign-in'))} />
            </Card>
        </Screen>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return (
        <Txt style={{
            fontSize: 12, fontWeight: '600', color: colors.textMuted,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: space.md,
        }}>{children}</Txt>
    );
}
