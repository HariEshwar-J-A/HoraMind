import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Panel, Section } from '@horamind/ui';
import { Txt, Box } from '../primitives.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/i18n.js';
import { colors, fonts, space, touchTarget } from '../../theme/tokens.js';

const KINDS = [
    'dasha_change', 'transit', 'life_stale', 'daily_compass', 'system',
] as const;

interface Prefs {
    kinds: Record<string, boolean>;
    quietFrom: number | null;
    quietTo: number | null;
}

function clock(mins: number | null): string {
    if (mins === null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseClock(v: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

export function NotifyPrefs() {
    const qc = useQueryClient();
    const prefs = useQuery<Prefs>({
        queryKey: ['notification-prefs'],
        queryFn: () => api.get('/v1/notification-prefs'),
    });

    const save = useMutation({
        mutationFn: (patch: Partial<Prefs>) => api.patch<Prefs>('/v1/notification-prefs', patch),
        onSuccess: data => qc.setQueryData(['notification-prefs'], data),
    });

    const data = prefs.data;
    if (!data) return null;

    return (
        <Section title={t('notify.prefs')}>
            <Panel>
                {KINDS.map(kind => {
                    const on = kind === 'system'
                        ? data.kinds.system !== false
                        : data.kinds[kind] === true;
                    return (
                        <Box key={kind} style={{
                            display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', gap: space.md,
                            paddingTop: space.md, paddingBottom: space.md,
                            borderBottomWidth: 1, borderBottomStyle: 'solid',
                            borderBottomColor: colors.border,
                        }}>
                            <Box style={{ minWidth: 0 }}>
                                <Txt style={{ fontSize: 15 }}>{t(`notify.kind.${kind}`)}</Txt>
                                <Txt style={{ fontSize: 12, color: colors.textFaint, lineHeight: 18 }}>
                                    {t(`notify.kind.${kind}.hint`)}
                                </Txt>
                            </Box>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                onClick={() => save.mutate({ kinds: { ...data.kinds, [kind]: !on } })}
                                style={{
                                    width: 48, height: 28, minWidth: 48, minHeight: 28,
                                    borderRadius: 999, border: 'none', flexShrink: 0,
                                    background: on ? colors.accent : colors.border,
                                    cursor: 'pointer', position: 'relative',
                                }}
                            >
                                <span style={{
                                    position: 'absolute', top: 4, left: on ? 24 : 4,
                                    width: 20, height: 20, borderRadius: 999,
                                    background: '#fff', transition: 'left 180ms ease',
                                }} />
                            </button>
                        </Box>
                    );
                })}

                <Txt style={{
                    fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted,
                    letterSpacing: 1, marginTop: space.lg, marginBottom: space.sm,
                }}>
                    {t('notify.quiet').toUpperCase()}
                </Txt>
                <Txt style={{ fontSize: 12, color: colors.textFaint, marginBottom: space.md, lineHeight: 18 }}>
                    {t('notify.quiet.hint')}
                </Txt>
                <Box style={{ display: 'flex', gap: space.md }}>
                    <input
                        type="time"
                        aria-label="Quiet from"
                        value={clock(data.quietFrom)}
                        onChange={e => save.mutate({ quietFrom: parseClock(e.target.value) })}
                        style={timeStyle}
                    />
                    <input
                        type="time"
                        aria-label="Quiet to"
                        value={clock(data.quietTo)}
                        onChange={e => save.mutate({ quietTo: parseClock(e.target.value) })}
                        style={timeStyle}
                    />
                </Box>
            </Panel>
        </Section>
    );
}

const timeStyle = {
    flex: 1, minHeight: touchTarget, padding: space.md,
    backgroundColor: colors.surface, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: 10, fontSize: 16,
} as const;
