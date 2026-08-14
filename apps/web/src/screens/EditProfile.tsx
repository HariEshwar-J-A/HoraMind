import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Field, Txt, Box, Notice } from '../components/primitives.js';
import { Reveal } from '../components/motion.js';
import { Panel, Rule, Segmented, Toast, Empty } from '@horamind/ui';
import LoadingState from '../components/bui/LoadingState.js';
import { api, ApiError } from '../lib/api.js';
import { useSession } from '../lib/session.js';
import { colors, fonts, space } from '../theme/tokens.js';

/**
 * Change your birth details.
 *
 * The chart is derived entirely from four values, and a person who typed one
 * wrong — or was later told their real birth time — has, until now, had no way
 * to correct it. Everything downstream is wrong from that moment and there was
 * no route back.
 *
 * Saving invalidates every derived query. That is the important part: the natal
 * chart is cached with `staleTime: Infinity` on the correct reasoning that a
 * birth chart is fixed for life — which stops being true the instant the birth
 * details themselves change. Without the invalidation the form would save
 * successfully and the chart would keep showing the old sky, which is a worse
 * failure than refusing the edit.
 */

interface Profile {
    id: string;
    label: string;
    birthDate: string;
    birthTime: string;
    timeAccuracy: 'exact' | 'approximate' | 'unknown';
    placeName: string;
    latitude: number;
    longitude: number;
    timezone: string;
}

interface Place {
    name: string; country: string; province: string;
    latitude: number; longitude: number; timezone: string;
}

export function EditProfile() {
    const qc = useQueryClient();
    const setProfile = useSession(s => s.setProfile);

    const { data, isLoading } = useQuery<{ profiles: Profile[] }>({
        queryKey: ['profiles'],
        queryFn: () => api.get('/v1/profiles'),
    });
    const profile = data?.profiles?.[0];

    const [draft, setDraft] = useState<Partial<Profile> | null>(null);
    const [placeQuery, setPlaceQuery] = useState('');
    const [saved, setSaved] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // The draft starts as a copy so cancelling is free and the fields are
    // controlled from the first keystroke rather than switching mid-edit.
    const form = { ...(profile ?? {}), ...(draft ?? {}) } as Profile;
    const set = (patch: Partial<Profile>) => setDraft(d => ({ ...(d ?? {}), ...patch }));

    const places = useQuery<{ results: Place[] }>({
        queryKey: ['places', placeQuery],
        queryFn: () => api.get(`/v1/places/search?query=${encodeURIComponent(placeQuery)}`),
        enabled: placeQuery.trim().length >= 2,
        staleTime: 1000 * 60 * 60,
    });

    const save = useMutation({
        mutationFn: (body: Partial<Profile>) =>
            api.patch<Profile>(`/v1/profiles/${profile!.id}`, body),
        onSuccess: fresh => {
            setError(null);
            setDraft(null);
            setSaved('Saved. Your chart and readings have been recomputed.');
            setProfile(fresh as never);

            // Everything derived from the birth moment. Missing one here is the
            // kind of bug that shows a new ascendant beside an old dasha and
            // looks like an engine fault rather than a stale cache.
            for (const key of [['profiles'], ['natal'], ['calendar'], ['compass'], ['life']]) {
                void qc.invalidateQueries({ queryKey: key });
            }
        },
        onError: (err: unknown) => {
            setError(err instanceof ApiError ? err.message : 'Could not save those details.');
        },
    });

    if (isLoading) {
        return <Screen title="Your details"><LoadingState label="Loading" variant="Dots" /></Screen>;
    }

    if (!profile) {
        return (
            <Screen title="Your details">
                <Empty
                    title="No birth details yet"
                    hint="Add them and every screen in the app starts working."
                />
            </Screen>
        );
    }

    const dirty = draft !== null && Object.keys(draft).length > 0;

    return (
        <Screen title="Your details">
            <Reveal>
                <Notice>
                    Changing anything here recomputes your chart, your calendar and your
                    life reading. Nothing is kept from the old details.
                </Notice>
            </Reveal>

            <Reveal delay={0.06}>
                <Panel tone="lit">
                    <Field
                        label="Date of birth"
                        type="date"
                        value={form.birthDate ?? ''}
                        onChange={v => set({ birthDate: v })}
                    />
                    <Field
                        label="Time of birth"
                        type="time"
                        value={(form.birthTime ?? '').slice(0, 5)}
                        // The API stores seconds; a time input never provides them.
                        onChange={v => set({ birthTime: `${v}:00` })}
                        hint="Even ten minutes changes the ascendant."
                    />

                    <Rule label="How sure are you of the time" />
                    <Segmented
                        label="Birth time accuracy"
                        value={form.timeAccuracy ?? 'exact'}
                        onChange={v => set({ timeAccuracy: v })}
                        options={[
                            { value: 'exact', label: 'Exact' },
                            { value: 'approximate', label: 'Approximate' },
                            { value: 'unknown', label: 'Unknown' },
                        ]}
                    />
                    <Txt style={{
                        fontSize: 11, color: colors.textFaint, marginTop: space.sm,
                        lineHeight: 17, fontFamily: fonts.mono,
                    }}>
                        Saying &ldquo;approximate&rdquo; is not a penalty — the app stops making
                        house-based claims rather than making unreliable ones.
                    </Txt>
                </Panel>
            </Reveal>

            <Reveal delay={0.12}>
                <Panel>
                    <Rule label="Place of birth" />
                    <Txt style={{ fontSize: 14, marginBottom: space.sm }}>
                        {form.placeName} · {form.timezone}
                    </Txt>

                    <Field
                        label="Change place"
                        value={placeQuery}
                        onChange={setPlaceQuery}
                        placeholder="Start typing a city"
                        hint="Pick from the list — the timezone comes with it."
                    />

                    {places.data?.results?.slice(0, 6).map(p => (
                        <Box
                            key={`${p.name}-${p.latitude}`}
                            onClick={() => {
                                set({
                                    placeName: [p.name, p.province, p.country].filter(Boolean).join(', '),
                                    latitude: p.latitude, longitude: p.longitude, timezone: p.timezone,
                                });
                                setPlaceQuery('');
                            }}
                            style={{
                                paddingTop: space.sm, paddingBottom: space.sm,
                                borderBottomWidth: 1, borderBottomStyle: 'solid',
                                borderBottomColor: colors.border, cursor: 'pointer',
                            }}
                        >
                            <Txt style={{ fontSize: 14 }}>{p.name}, {p.country}</Txt>
                            <Txt style={{ fontSize: 12, color: colors.textFaint, fontFamily: fonts.mono }}>
                                {p.timezone}
                            </Txt>
                        </Box>
                    ))}

                    {placeQuery.trim().length >= 2 && places.data?.results?.length === 0 && (
                        <Txt style={{ fontSize: 13, color: colors.textFaint, marginTop: space.sm }}>
                            No match. Try the nearest larger city — the coordinates only need to
                            be close enough for the timezone and the ascendant.
                        </Txt>
                    )}
                </Panel>
            </Reveal>

            {error && <Notice tone="error">{error}</Notice>}

            <Reveal delay={0.18}>
                <Card>
                    <Button
                        label={save.isPending ? 'Recomputing…' : dirty ? 'Save and recompute' : 'No changes yet'}
                        onPress={() => save.mutate(draft ?? {})}
                        disabled={!dirty || save.isPending}
                    />
                    {dirty && (
                        <Button
                            variant="ghost"
                            label="Discard changes"
                            onPress={() => { setDraft(null); setError(null); }}
                            style={{ marginTop: space.sm }}
                        />
                    )}
                </Card>
            </Reveal>

            <Toast message={saved} onDone={() => setSaved(null)} />
        </Screen>
    );
}
