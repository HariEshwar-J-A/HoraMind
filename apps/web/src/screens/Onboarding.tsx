import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BirthProfile, PlaceResult } from '@horamind/shared';
import { Screen, Card, Field, Button, Txt, Box, Notice } from '../components/primitives.js';
import { api, ApiError } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { colors, space, radius, touchTarget } from '../theme/tokens.js';

/**
 * Birth details.
 *
 * The place picker resolves a city to coordinates *and* an IANA timezone. That
 * last part is why free text is not accepted: a chart computed in the wrong zone
 * is wrong by the whole offset, which for India is five and a half hours and
 * roughly five signs of ascendant. The user must pick a real place.
 */
export function Onboarding() {
    const navigate = useNavigate();
    const { setProfile } = useSession();

    const [birthDate, setBirthDate] = useState('');
    const [birthTime, setBirthTime] = useState('');
    const [accuracy, setAccuracy] = useState<'exact' | 'approximate' | 'unknown'>('exact');
    const [placeQuery, setPlaceQuery] = useState('');
    const [places, setPlaces] = useState<PlaceResult[]>([]);
    const [place, setPlace] = useState<PlaceResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const search = async (q: string) => {
        setPlaceQuery(q);
        setPlace(null);
        if (q.trim().length < 2) { setPlaces([]); return; }
        try {
            const res = await api.request<{ results: PlaceResult[] }>(
                `/v1/places/search?query=${encodeURIComponent(q)}&limit=8`,
                { method: 'GET', skipAuth: true },
            );
            setPlaces(res.results);
        } catch {
            setPlaces([]);
        }
    };

    const submit = async () => {
        if (!place) { setError('Choose your birth place from the list.'); return; }
        setBusy(true);
        setError(null);
        try {
            const profile = await api.post<BirthProfile>('/v1/profiles', {
                label: 'Me',
                birthDate,
                // An unknown time still needs a value; noon minimises the error
                // in the Moon's position, which is what the dasha depends on.
                birthTime: accuracy === 'unknown' ? '12:00:00' : `${birthTime}:00`,
                timeAccuracy: accuracy,
                placeName: `${place.name}, ${place.country}`,
                latitude: place.latitude,
                longitude: place.longitude,
                timezone: place.timezone,
                isPrimary: true,
            });
            setProfile(profile);
            navigate('/');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not save your details.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen title="Your birth details">
            <Txt style={{ color: colors.textMuted, marginBottom: space.lg }}>
                These are used to compute your chart. They are stored once and never shared.
            </Txt>

            <Card>
                {error && <Notice tone="error">{error}</Notice>}

                <Field label="Date of birth" type="date" value={birthDate} onChange={setBirthDate} />

                <Box style={{ marginBottom: space.lg }}>
                    <Txt as="span" style={{ fontSize: 12, color: colors.textMuted, display: 'block', marginBottom: space.xs }}>
                        How sure are you of the time?
                    </Txt>
                    <Box style={{ display: 'flex', gap: space.sm }}>
                        {(['exact', 'approximate', 'unknown'] as const).map(option => (
                            <Box
                                key={option}
                                onClick={() => setAccuracy(option)}
                                style={{
                                    flex: 1,
                                    minHeight: touchTarget,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: radius.md,
                                    borderWidth: 1,
                                    borderStyle: 'solid',
                                    borderColor: accuracy === option ? colors.accent : colors.border,
                                    backgroundColor: accuracy === option ? colors.accentSoft : colors.surface,
                                    cursor: 'pointer',
                                    fontSize: 14,
                                    color: colors.text,
                                    textTransform: 'capitalize',
                                }}
                            >
                                {option}
                            </Box>
                        ))}
                    </Box>
                </Box>

                {accuracy !== 'unknown' && (
                    <Field label="Time of birth" type="time" value={birthTime} onChange={setBirthTime} />
                )}

                {accuracy !== 'exact' && (
                    <Notice tone="warn">
                        Without an exact time the ascendant and house positions are unreliable, so
                        readings will lean on planetary positions and dashas instead. You can
                        correct this later.
                    </Notice>
                )}

                <Field
                    label="Place of birth"
                    value={place ? `${place.name}, ${place.country}` : placeQuery}
                    onChange={q => void search(q)}
                    placeholder="Start typing a city"
                    hint={place ? `Timezone: ${place.timezone}` : 'Pick from the list — the timezone comes with it.'}
                />

                {!place && places.length > 0 && (
                    <Box style={{
                        marginTop: -space.md, marginBottom: space.lg,
                        borderRadius: radius.md, overflow: 'hidden',
                        borderWidth: 1, borderStyle: 'solid', borderColor: colors.border,
                    }}>
                        {places.map((p, i) => (
                            <Box
                                key={`${p.name}-${p.latitude}-${i}`}
                                onClick={() => { setPlace(p); setPlaces([]); }}
                                style={{
                                    padding: space.md,
                                    minHeight: touchTarget,
                                    backgroundColor: colors.surfaceRaised,
                                    borderBottomWidth: i === places.length - 1 ? 0 : 1,
                                    borderBottomStyle: 'solid',
                                    borderBottomColor: colors.border,
                                    cursor: 'pointer',
                                }}
                            >
                                <Txt style={{ fontSize: 15 }}>{p.name}, {p.country}</Txt>
                                <Txt style={{ fontSize: 12, color: colors.textFaint }}>{p.timezone}</Txt>
                            </Box>
                        ))}
                    </Box>
                )}

                <Button
                    label={busy ? 'Saving…' : 'Show my chart'}
                    onPress={() => void submit()}
                    disabled={busy || !birthDate || !place || (accuracy !== 'unknown' && !birthTime)}
                />
            </Card>
        </Screen>
    );
}
