import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, Card, Field, Button, Txt, Box, Notice } from '../components/primitives.js';
import { useSession, currentTimezone } from '../lib/session.js';
import { ApiError } from '../lib/api.js';
import { colors, space } from '../theme/tokens.js';

/**
 * Sign in and registration.
 *
 * One screen with a mode toggle rather than two routes: the fields are almost
 * identical, and a user who picked the wrong one should not have to navigate to
 * fix it.
 */
export function SignIn() {
    const navigate = useNavigate();
    const { signIn, register } = useSession();

    const [mode, setMode] = useState<'in' | 'up'>('in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            if (mode === 'in') {
                await signIn(email, password);
                navigate('/');
            } else {
                await register(email, password, currentTimezone());
                // A new account has no chart yet, and everything else needs one.
                navigate('/onboarding');
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen>
            <Box style={{ marginTop: space.xxxl, marginBottom: space.xl }}>
                <Txt as="h1" style={{ fontSize: 32, fontWeight: '600' }}>HoraMind</Txt>
                <Txt style={{ color: colors.textMuted, marginTop: space.sm }}>
                    Vedic astrology, computed properly.
                </Txt>
            </Box>

            <Card>
                {error && <Notice tone="error">{error}</Notice>}

                <Field
                    label="Email" type="email" value={email} onChange={setEmail}
                    placeholder="you@example.com"
                />
                <Field
                    label="Password" type="password" value={password} onChange={setPassword}
                    hint={mode === 'up' ? 'At least 10 characters. Length matters more than symbols.' : undefined}
                />

                <Button
                    label={busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
                    onPress={() => void submit()}
                    disabled={busy || !email || password.length < 1}
                />

                <Button
                    variant="ghost"
                    style={{ marginTop: space.sm }}
                    label={mode === 'in' ? 'Create an account instead' : 'I already have an account'}
                    onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}
                />
            </Card>

            {mode === 'up' && (
                <Txt style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
                    Your conversations are never used for advertising or profiling, never sold,
                    and are deleted after 7 days. Only what you save as a Memory is kept.
                </Txt>
            )}
        </Screen>
    );
}
