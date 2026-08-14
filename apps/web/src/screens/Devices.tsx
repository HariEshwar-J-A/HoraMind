import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionSummary } from '@horamind/shared';
import { Screen, Card, Button, Txt, Box, Notice } from '../components/primitives.js';
import { ErrorState } from '@horamind/ui';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { colors, space } from '../theme/tokens.js';

/**
 * Signed-in devices.
 *
 * The user asked for no sessions but for the ability to sign out of a chosen
 * device or all of them — which are the same feature. They never see the word
 * "session"; they see a list of places they are signed in, which is the useful
 * form of the same fact.
 */
export function Devices() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { signOut } = useSession();

    const { data, isLoading, refetch, isError } = useQuery<{ sessions: SessionSummary[] }>({
        queryKey: ['sessions'], queryFn: () => api.get('/v1/sessions'),
    });

    const revoke = useMutation({
        mutationFn: (body: { sessionId?: string; all?: boolean }) =>
            api.post<{ signedOutSelf: boolean }>('/v1/sessions/revoke', body),
        onSuccess: async result => {
            // Revoking the current device leaves an access token that will fail
            // on its next use. Clearing locally and returning to sign-in is the
            // honest response; staying on the page would show stale data until
            // something happened to fail.
            if (result.signedOutSelf) {
                await signOut();
                navigate('/sign-in');
            } else {
                void qc.invalidateQueries({ queryKey: ['sessions'] });
            }
        },
    });

    if (isLoading) return <Screen title="Devices"><Txt style={{ color: colors.textMuted }}>Loading…</Txt></Screen>;

    if (isError || (!isLoading && !data)) {
        return (
            <Screen title="Signed-in devices">
                <ErrorState title="Could not load devices" onRetry={() => void refetch()} />
            </Screen>
        );
    }

    return (
        <Screen title="Signed-in devices">
            <Notice>
                Signing out of a device takes effect immediately, not when its session expires.
            </Notice>

            {data?.sessions.map(s => (
                <Card key={s.id}>
                    <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                            <Txt style={{ fontSize: 15, fontWeight: '500' }}>
                                {s.label ?? 'Unknown device'}
                                {s.current && (
                                    <Txt as="span" style={{ fontSize: 12, color: colors.accent, marginLeft: space.sm }}>
                                        This device
                                    </Txt>
                                )}
                            </Txt>
                            <Txt style={{ fontSize: 12, color: colors.textFaint, marginTop: space.xs }}>
                                {s.platform ?? 'unknown'} · last used {new Date(s.lastSeenAt).toLocaleDateString()}
                            </Txt>
                        </Box>
                    </Box>
                    <Button
                        variant={s.current ? 'ghost' : 'secondary'}
                        style={{ marginTop: space.md }}
                        label={s.current ? 'Sign out of this device' : 'Sign out'}
                        onPress={() => revoke.mutate({ sessionId: s.id })}
                    />
                </Card>
            ))}

            <Button
                variant="danger"
                label="Sign out everywhere"
                onPress={() => revoke.mutate({ all: true })}
            />
            <Txt style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: space.sm }}>
                This includes the device you are using now.
            </Txt>
        </Screen>
    );
}
