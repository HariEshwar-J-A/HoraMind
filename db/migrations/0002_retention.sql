-- Retention.
--
-- The app tells users their chats are permanently deleted after 7 days. That
-- claim has to be executed by something, and a claim enforced only by
-- application code is one bug away from being false. These functions are the
-- mechanism; a scheduler calls `run_retention()` hourly.
--
-- Deletes are hard, not soft. `chat_messages` and `chat_summaries` cascade from
-- `chats`, so removing the parent removes the text.

BEGIN;

/** Delete chats past their expiry. Returns how many were removed. */
CREATE OR REPLACE FUNCTION purge_expired_chats() RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM chats WHERE expires_at <= now() RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

/** Drop sessions that are revoked or past expiry; they carry no useful history. */
CREATE OR REPLACE FUNCTION purge_dead_sessions() RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM sessions
         WHERE expires_at <= now()
            OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
        RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

/** Consumed or expired one-time tokens. */
CREATE OR REPLACE FUNCTION purge_auth_tokens() RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM auth_tokens
         WHERE expires_at <= now() OR consumed_at IS NOT NULL
        RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

/**
 * Finish account deletions past their grace period.
 *
 * Deleting the user cascades to profiles, memories, interests, chats and
 * sessions. `llm_calls` and `rag_calls` null their user_id instead, because the
 * billing and retrieval-quality record must survive the account without
 * remaining attached to a person.
 */
CREATE OR REPLACE FUNCTION purge_deleted_users(grace interval DEFAULT interval '30 days')
RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM users
         WHERE deleted_at IS NOT NULL AND deleted_at < now() - grace
        RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

/** Compass entries are a cache; anything older than a week is dead weight. */
CREATE OR REPLACE FUNCTION purge_stale_compass() RETURNS integer AS $$
DECLARE
    removed integer;
BEGIN
    WITH gone AS (
        DELETE FROM daily_compass
         WHERE local_date < current_date - 7
        RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;
    RETURN removed;
END;
$$ LANGUAGE plpgsql;

/** Everything above, in one call for the scheduler. */
CREATE OR REPLACE FUNCTION run_retention()
RETURNS TABLE (task text, rows_removed integer) AS $$
BEGIN
    RETURN QUERY SELECT 'chats'::text,        purge_expired_chats();
    RETURN QUERY SELECT 'sessions'::text,     purge_dead_sessions();
    RETURN QUERY SELECT 'auth_tokens'::text,  purge_auth_tokens();
    RETURN QUERY SELECT 'users'::text,        purge_deleted_users();
    RETURN QUERY SELECT 'compass'::text,      purge_stale_compass();
END;
$$ LANGUAGE plpgsql;

COMMIT;
