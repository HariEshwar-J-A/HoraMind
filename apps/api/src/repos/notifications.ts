import type { Sql } from '../db/client.js';
import type { NotificationKind } from '@horamind/shared';

/**
 * Notification persistence.
 *
 * Prefs default to an empty kinds object, which the service reads as "off for
 * everything except system". Inserting a row with every kind set to true would
 * opt people in by existing, which is the opposite of the product decision.
 */

export interface NotificationRow {
    id: string;
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    href: string | null;
    readAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
}

export interface PrefsRow {
    userId: string;
    kinds: Record<string, boolean>;
    quietFrom: number | null;
    quietTo: number | null;
    updatedAt: Date;
}

export interface SnapshotRow {
    birthProfileId: string;
    dashaStack: string;
    saturnSign: number | null;
    jupiterSign: number | null;
    sadeSati: boolean;
    updatedAt: Date;
}

export function toNotification(r: NotificationRow) {
    return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        href: r.href,
        readAt: r.readAt ? r.readAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
    };
}

export async function listNotifications(
    sql: Sql,
    userId: string,
    unreadOnly: boolean,
): Promise<NotificationRow[]> {
    if (unreadOnly) {
        return sql<NotificationRow[]>`
            SELECT id, user_id, kind, title, body, href, read_at, created_at, expires_at
              FROM notifications
             WHERE user_id = ${userId} AND read_at IS NULL AND expires_at > now()
             ORDER BY created_at DESC
             LIMIT 100`;
    }
    return sql<NotificationRow[]>`
        SELECT id, user_id, kind, title, body, href, read_at, created_at, expires_at
          FROM notifications
         WHERE user_id = ${userId} AND expires_at > now()
         ORDER BY created_at DESC
         LIMIT 100`;
}

export async function unreadCount(sql: Sql, userId: string): Promise<number> {
    const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM notifications
         WHERE user_id = ${userId} AND read_at IS NULL AND expires_at > now()`;
    return row?.n ?? 0;
}

export async function markRead(sql: Sql, userId: string, id: string): Promise<boolean> {
    const rows = await sql`
        UPDATE notifications SET read_at = now()
         WHERE id = ${id} AND user_id = ${userId} AND read_at IS NULL
     RETURNING id`;
    return rows.length > 0;
}

export async function markAllRead(sql: Sql, userId: string): Promise<number> {
    const rows = await sql`
        UPDATE notifications SET read_at = now()
         WHERE user_id = ${userId} AND read_at IS NULL
     RETURNING id`;
    return rows.length;
}

export async function insertNotification(
    sql: Sql,
    input: {
        userId: string;
        kind: NotificationKind;
        title: string;
        body: string;
        href?: string | null;
    },
): Promise<NotificationRow> {
    const [row] = await sql<NotificationRow[]>`
        INSERT INTO notifications (user_id, kind, title, body, href)
        VALUES (${input.userId}, ${input.kind}, ${input.title}, ${input.body}, ${input.href ?? null})
        RETURNING id, user_id, kind, title, body, href, read_at, created_at, expires_at`;
    if (!row) throw new Error('Notification insert returned no row');
    return row;
}

/**
 * Deduplicate: do not emit the same kind+title for the same user within a day.
 *
 * A detector that runs every hour would otherwise stack identical "Jupiter
 * dasha has begun" cards until the user mutes the app.
 */
export async function recentlyEmitted(
    sql: Sql,
    userId: string,
    kind: NotificationKind,
    title: string,
): Promise<boolean> {
    const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM notifications
         WHERE user_id = ${userId} AND kind = ${kind} AND title = ${title}
           AND created_at > now() - interval '24 hours'`;
    return (row?.n ?? 0) > 0;
}

export async function getPrefs(sql: Sql, userId: string): Promise<PrefsRow> {
    const [row] = await sql<PrefsRow[]>`
        SELECT user_id, kinds, quiet_from, quiet_to, updated_at
          FROM notification_prefs WHERE user_id = ${userId}`;
    if (row) return row;
    return {
        userId,
        kinds: {},
        quietFrom: null,
        quietTo: null,
        updatedAt: new Date(),
    };
}

export async function upsertPrefs(
    sql: Sql,
    userId: string,
    patch: { kinds?: Record<string, boolean>; quietFrom?: number | null; quietTo?: number | null },
): Promise<PrefsRow> {
    const current = await getPrefs(sql, userId);
    const kinds = { ...current.kinds, ...(patch.kinds ?? {}) };
    const quietFrom = patch.quietFrom === undefined ? current.quietFrom : patch.quietFrom;
    const quietTo = patch.quietTo === undefined ? current.quietTo : patch.quietTo;

    const [row] = await sql<PrefsRow[]>`
        INSERT INTO notification_prefs (user_id, kinds, quiet_from, quiet_to, updated_at)
        VALUES (${userId}, ${sql.json(kinds as never)}, ${quietFrom}, ${quietTo}, now())
        ON CONFLICT (user_id) DO UPDATE
           SET kinds = EXCLUDED.kinds,
               quiet_from = EXCLUDED.quiet_from,
               quiet_to = EXCLUDED.quiet_to,
               updated_at = now()
        RETURNING user_id, kinds, quiet_from, quiet_to, updated_at`;
    if (!row) throw new Error('Prefs upsert returned no row');
    return row;
}

export async function savePush(
    sql: Sql,
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
    await sql`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (${userId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
        ON CONFLICT (endpoint) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               p256dh = EXCLUDED.p256dh,
               auth = EXCLUDED.auth`;
}

export async function deletePush(sql: Sql, userId: string, endpoint?: string): Promise<number> {
    if (endpoint) {
        const rows = await sql`
            DELETE FROM push_subscriptions
             WHERE user_id = ${userId} AND endpoint = ${endpoint}
         RETURNING id`;
        return rows.length;
    }
    const rows = await sql`
        DELETE FROM push_subscriptions WHERE user_id = ${userId} RETURNING id`;
    return rows.length;
}

export async function listPush(sql: Sql, userId: string) {
    return sql<{ endpoint: string; p256dh: string; auth: string }[]>`
        SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`;
}

export async function getSnapshot(sql: Sql, profileId: string): Promise<SnapshotRow | null> {
    const [row] = await sql<SnapshotRow[]>`
        SELECT birth_profile_id, dasha_stack, saturn_sign, jupiter_sign, sade_sati, updated_at
          FROM sky_snapshots WHERE birth_profile_id = ${profileId}`;
    return row ?? null;
}

export async function upsertSnapshot(
    sql: Sql,
    input: {
        birthProfileId: string;
        dashaStack: string;
        saturnSign: number | null;
        jupiterSign: number | null;
        sadeSati: boolean;
    },
): Promise<void> {
    await sql`
        INSERT INTO sky_snapshots
            (birth_profile_id, dasha_stack, saturn_sign, jupiter_sign, sade_sati, updated_at)
        VALUES (${input.birthProfileId}, ${input.dashaStack}, ${input.saturnSign},
                ${input.jupiterSign}, ${input.sadeSati}, now())
        ON CONFLICT (birth_profile_id) DO UPDATE
           SET dasha_stack = EXCLUDED.dasha_stack,
               saturn_sign = EXCLUDED.saturn_sign,
               jupiter_sign = EXCLUDED.jupiter_sign,
               sade_sati = EXCLUDED.sade_sati,
               updated_at = now()`;
}

export interface WatchRow {
    userId: string;
    timezone: string;
    profile: import('./profiles.js').ProfileRow;
}

/**
 * Every live account with a primary profile.
 *
 * The detector walks this once an hour. A join rather than two queries keeps
 * a user-without-a-profile (mid-onboarding) out of the loop, which would
 * otherwise throw on every tick.
 */
export async function listWatched(sql: Sql): Promise<WatchRow[]> {
    const rows = await sql<(import('./profiles.js').ProfileRow & {
        userId: string;
        userTimezone: string;
    })[]>`
        SELECT bp.id, bp.user_id, bp.label, bp.is_primary, bp.birth_date, bp.birth_time,
               bp.time_accuracy, bp.place_name, bp.latitude, bp.longitude, bp.timezone,
               bp.ayanamsa, bp.node_type, bp.position_mode, bp.house_system,
               bp.dasamsa_scheme, bp.hora_scheme, bp.created_at, bp.updated_at,
               u.timezone AS user_timezone
          FROM birth_profiles bp
          JOIN users u ON u.id = bp.user_id
         WHERE bp.is_primary AND u.deleted_at IS NULL`;

    return rows.map(r => ({
        userId: r.userId,
        timezone: r.userTimezone,
        profile: r,
    }));
}
