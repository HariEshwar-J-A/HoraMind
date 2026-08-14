-- Notifications: in-app centre, per-kind prefs, push subscriptions, and the
-- last-seen dasha/transit snapshot the detector compares against.
--
-- Defaulting kinds to OFF (except `system`) is deliberate. An app that opts
-- people in to a daily ping is an app they mute. Quiet hours are stored in
-- the user's own zone as minutes from midnight; they are enforced at send
-- time on the server, because client-side suppression still lets the phone
-- buzz at 3am.
--
-- `updated_at` is set by the writing statement. No table in this schema uses
-- a trigger, and introducing the first would mean two conventions for one
-- column.

BEGIN;

CREATE TYPE notification_kind AS ENUM
    ('daily_compass', 'dasha_change', 'transit', 'life_stale', 'system');

CREATE TABLE notification_prefs (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    kinds       jsonb NOT NULL DEFAULT '{}',
    quiet_from  smallint CHECK (quiet_from IS NULL OR (quiet_from >= 0 AND quiet_from < 1440)),
    quiet_to    smallint CHECK (quiet_to   IS NULL OR (quiet_to   >= 0 AND quiet_to   < 1440)),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        notification_kind NOT NULL,
    title       text NOT NULL,
    body        text NOT NULL,
    href        text,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

CREATE INDEX notifications_unread ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE push_subscriptions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    text NOT NULL,
    p256dh      text NOT NULL,
    auth        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (endpoint)
);

/**
 * Last-seen dasha stack and slow transits, one row per profile.
 *
 * The detector compares today's computation to this row and emits only on
 * difference. Without it, every run would have to recompute yesterday — and
 * a missed hour would silently skip a boundary.
 */
CREATE TABLE sky_snapshots (
    birth_profile_id uuid PRIMARY KEY REFERENCES birth_profiles(id) ON DELETE CASCADE,
    dasha_stack      text NOT NULL,
    saturn_sign      smallint,
    jupiter_sign     smallint,
    sade_sati        boolean NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION purge_expired_notifications() RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM notifications WHERE expires_at <= now() RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION run_retention()
RETURNS TABLE (task text, rows_removed integer) AS $$
BEGIN
    RETURN QUERY SELECT 'chats'::text,          purge_expired_chats();
    RETURN QUERY SELECT 'sessions'::text,       purge_dead_sessions();
    RETURN QUERY SELECT 'auth_tokens'::text,    purge_auth_tokens();
    RETURN QUERY SELECT 'users'::text,          purge_deleted_users();
    RETURN QUERY SELECT 'compass'::text,        purge_stale_compass();
    RETURN QUERY SELECT 'notifications'::text,  purge_expired_notifications();
END;
$$ LANGUAGE plpgsql;

COMMIT;
