import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconButton, Sheet, Empty, Badge, Section } from '@horamind/ui';
import { api } from '../../lib/api.js';
import { t } from '../../lib/i18n.js';
import { brass, colors, fonts, space } from '../../theme/tokens.js';

interface Note {
    id: string;
    kind: string;
    title: string;
    body: string;
    href: string | null;
    readAt: string | null;
    createdAt: string;
}

/**
 * Bell + centre.
 *
 * Lives under `components/` because the sheet is DOM chrome. Permission for
 * push is requested only when a push-related toggle is turned on, never on
 * load — a prompt before the value is understood is how an app gets
 * permanently denied.
 */
export function NotifyBell({ wide }: { wide: boolean }) {
    const [open, setOpen] = useState(false);
    const qc = useQueryClient();

    const list = useQuery<{ notifications: Note[]; unread: number }>({
        queryKey: ['notifications'],
        queryFn: () => api.get('/v1/notifications'),
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    const markAll = useMutation({
        mutationFn: () => api.post('/v1/notifications/read-all'),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
    });

    const markOne = useMutation({
        mutationFn: (id: string) => api.post(`/v1/notifications/${id}/read`),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
    });

    const unread = list.data?.unread ?? 0;
    const items = list.data?.notifications ?? [];

    return (
        <>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
                <IconButton label={t('notify.bell')} onPress={() => setOpen(true)}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={unread ? brass.mid : colors.textMuted} strokeWidth="1.8" strokeLinecap="round">
                        <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
                        <path d="M9 17a3 3 0 0 0 6 0" />
                    </svg>
                </IconButton>
                {unread > 0 && (
                    <span
                        aria-live="polite"
                        aria-label={`${unread} unread`}
                        style={{
                            position: 'absolute', top: 6, right: 6,
                            minWidth: 16, height: 16, padding: '0 4px',
                            borderRadius: 999, background: brass.mid, color: '#1a1503',
                            fontSize: 10, fontWeight: 700, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontFamily: fonts.mono,
                        }}
                    >
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </span>

            <Sheet
                open={open}
                onClose={() => setOpen(false)}
                title={t('notify.bell')}
                placement={wide ? 'dialog' : 'sheet'}
            >
                {items.length === 0 ? (
                    <Empty title={t('notify.empty')} hint={t('notify.empty.hint')} />
                ) : (
                    <>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={() => markAll.mutate()}
                                style={{
                                    background: 'none', border: 'none', color: brass.mid,
                                    fontSize: 13, cursor: 'pointer', marginBottom: space.md, padding: 0,
                                }}
                            >
                                {t('notify.markAll')}
                            </button>
                        )}
                        {items.map(n => (
                            <button
                                key={n.id}
                                type="button"
                                onClick={() => { if (!n.readAt) markOne.mutate(n.id); }}
                                style={{
                                    display: 'block', width: '100%', textAlign: 'left',
                                    padding: '12px 0', background: 'none', border: 'none',
                                    borderBottom: `1px solid ${colors.border}`,
                                    cursor: 'pointer', opacity: n.readAt ? 0.65 : 1,
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontSize: 15, color: colors.text, fontWeight: n.readAt ? 400 : 600 }}>
                                        {n.title}
                                    </span>
                                    {!n.readAt && <Badge tone="warn">new</Badge>}
                                </div>
                                <p style={{
                                    margin: '4px 0 0', fontSize: 13, color: colors.textMuted,
                                    lineHeight: '20px',
                                }}>
                                    {n.body}
                                </p>
                            </button>
                        ))}
                    </>
                )}
                <Section title={t('notify.prefs')} style={{ marginTop: space.lg }}>
                    <a href="/you" onClick={() => setOpen(false)} style={{
                        color: brass.mid, fontSize: 13, textDecoration: 'none',
                    }}>
                        {t('notify.prefs')} →
                    </a>
                </Section>
            </Sheet>
        </>
    );
}
