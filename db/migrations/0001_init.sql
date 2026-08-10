-- HoraMind initial schema.
--
-- Design notes that are not obvious from the column names:
--
--   * Internal keys are UUIDs; `users.public_id` is the 8-hex handle the user
--     sees. Collisions in 32 bits become likely around 65k users (birthday
--     bound), so it is generated with retry and kept out of foreign keys.
--   * There is a sessions table even though the product says "no sessions".
--     Revoking one device requires a server-side record of that device; a bare
--     stateless JWT cannot be revoked. Access tokens stay short-lived, and this
--     table holds only the refresh side.
--   * Chats are retention-limited to 7 days and hard-deleted. `expires_at` is
--     stored rather than derived so the retention window can differ per tier
--     without rewriting rows.
--   * Nothing here stores the text of a user's question outside `chat_messages`,
--     which expires. `rag_calls` deliberately holds a hash and the retrieved
--     verse ids, so retrieval quality stays debuggable without retaining what
--     the user typed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE auth_provider   AS ENUM ('password', 'google', 'apple', 'github');
CREATE TYPE user_tier       AS ENUM ('free', 'plus', 'pro');
CREATE TYPE birth_time_accuracy AS ENUM ('exact', 'approximate', 'unknown');
CREATE TYPE chat_role       AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TYPE interest_source AS ENUM ('user', 'derived');
CREATE TYPE llm_purpose     AS ENUM ('chat', 'compass', 'reading', 'interest_refresh', 'compaction');
CREATE TYPE usage_kind      AS ENUM ('chat_message', 'compass', 'reading', 'rag_query');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- User-visible handle: 8 uppercase hex characters, e.g. "A3F91C0B".
    public_id       char(8)     NOT NULL UNIQUE
                                CHECK (public_id ~ '^[0-9A-F]{8}$'),
    email           text        NOT NULL,
    email_verified_at timestamptz,
    -- NULL for accounts created purely through Google/Apple. Argon2id.
    password_hash   text,
    display_name    text,
    tier            user_tier   NOT NULL DEFAULT 'free',
    locale          text        NOT NULL DEFAULT 'en',
    -- The user's own timezone, distinct from their birth timezone. The daily
    -- compass needs to know when "today" starts for them.
    timezone        text        NOT NULL DEFAULT 'UTC',
    ads_enabled     boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Soft delete first; a scheduled job hard-deletes after the grace period so
    -- an accidental deletion is recoverable and a real one is honoured.
    deleted_at      timestamptz
);

-- Case-insensitive uniqueness without depending on the citext extension.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE deleted_at IS NULL;

/**
 * Allocate an unused 8-hex public id.
 *
 * Retries on collision rather than assuming 2^32 is roomy: the relevant bound
 * is the birthday one, so collisions start appearing in the tens of thousands
 * of users, not the billions.
 */
CREATE OR REPLACE FUNCTION allocate_public_id() RETURNS char(8) AS $$
DECLARE
    candidate char(8);
BEGIN
    LOOP
        candidate := upper(encode(gen_random_bytes(4), 'hex'));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE public_id = candidate);
    END LOOP;
    RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- One row per linked login method. A user may hold both a password and a
-- Google identity; unlinking one must not orphan the account, which the
-- application enforces by refusing to remove the last remaining credential.
CREATE TABLE identities (
    id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            auth_provider NOT NULL,
    -- Provider's stable subject id ("sub"), not the email: users change emails,
    -- and Apple's Private Relay address is not a durable identifier.
    provider_account_id text          NOT NULL,
    email_at_provider   text,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    last_used_at        timestamptz,
    UNIQUE (provider, provider_account_id)
);

CREATE INDEX identities_user_idx ON identities (user_id);

-- One row per signed-in device. This is what "log out of this device" and
-- "log out everywhere" act on.
CREATE TABLE sessions (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 of the refresh token. The token itself is never stored, so a
    -- database leak does not hand over live sessions.
    refresh_token_hash bytea       NOT NULL UNIQUE,
    -- The hash this one replaced, kept for exactly one rotation.
    --
    -- Refresh tokens rotate on every use, so a previous token should never be
    -- presented again. If one is, the most likely explanation is that it was
    -- stolen and the thief is racing the legitimate client. Recognising the old
    -- value is what lets us detect that and revoke the session, rather than
    -- silently treating it as an unknown token.
    previous_token_hash bytea,
    -- Shown in the device list, so it has to be recognisable to a human.
    device_label       text,
    platform           text,
    app_version        text,
    -- Truncated/hashed at the application layer; kept only to let a user spot a
    -- session they do not recognise.
    ip_hash            bytea,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz
);

CREATE INDEX sessions_user_active_idx ON sessions (user_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX sessions_previous_token_idx ON sessions (previous_token_hash)
    WHERE previous_token_hash IS NOT NULL;

-- Short-lived, single-use tokens for email verification and password reset.
CREATE TABLE auth_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     text        NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
    token_hash  bytea       NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Birth data
-- ---------------------------------------------------------------------------

-- The calculation settings are stored *with* the profile, not read from a
-- global default. node-jhora is fully configurable, and a chart that silently
-- changes because a server default moved is worse than one that is wrong
-- consistently. These columns pin reproducibility.
CREATE TABLE birth_profiles (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label          text        NOT NULL DEFAULT 'Me',
    is_primary     boolean     NOT NULL DEFAULT true,

    birth_date     date        NOT NULL,
    birth_time     time        NOT NULL,
    time_accuracy  birth_time_accuracy NOT NULL DEFAULT 'exact',
    place_name     text        NOT NULL,
    latitude       numeric(9,6)  NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude      numeric(9,6)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    timezone       text        NOT NULL,

    ayanamsa       text        NOT NULL DEFAULT 'true_chitra',
    node_type      text        NOT NULL DEFAULT 'true',
    position_mode  text        NOT NULL DEFAULT 'geometric',
    house_system   text        NOT NULL DEFAULT 'whole_sign',
    dasamsa_scheme text        NOT NULL DEFAULT 'parashara',
    hora_scheme    text        NOT NULL DEFAULT 'parashara',

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The product exposes a single chart today. The table permits more (family
-- members, comparison charts) because adding the row is free now and a
-- migration later is not; the API simply returns the primary one.
CREATE UNIQUE INDEX birth_profiles_one_primary ON birth_profiles (user_id)
    WHERE is_primary;
CREATE INDEX birth_profiles_user_idx ON birth_profiles (user_id);

-- ---------------------------------------------------------------------------
-- Memories and interests
-- ---------------------------------------------------------------------------

-- The four fields mirror what the user is asked: when, what happened, how it
-- affected them, what they learnt. Kept as separate columns rather than one
-- blob so the prompt builder can weight them differently — "what I learnt" is
-- the part that should steer advice.
CREATE TABLE memories (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occurred_on    date,
    what_happened  text        NOT NULL CHECK (length(what_happened) BETWEEN 1 AND 2000),
    how_it_affected text       CHECK (length(how_it_affected) <= 2000),
    what_i_learnt  text        CHECK (length(what_i_learnt) <= 2000),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memories_user_idx ON memories (user_id, occurred_on DESC NULLS LAST);

CREATE TABLE interests (
    id            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label         text            NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    weight        real            NOT NULL DEFAULT 1.0 CHECK (weight BETWEEN 0 AND 1),
    source        interest_source NOT NULL DEFAULT 'user',
    refreshed_at  timestamptz     NOT NULL DEFAULT now(),
    created_at    timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (user_id, label)
);

/**
 * Cap per-user rows for the tables that have a product limit.
 *
 * Enforced in the database as well as the application: the limits are a cost
 * control on prompt size, and an API bug that silently exceeded them would show
 * up as a bill rather than an error.
 */
CREATE OR REPLACE FUNCTION enforce_row_cap() RETURNS trigger AS $$
DECLARE
    cap  int := TG_ARGV[0]::int;
    used int;
BEGIN
    EXECUTE format('SELECT count(*) FROM %I WHERE user_id = $1', TG_TABLE_NAME)
        INTO used USING NEW.user_id;
    IF used >= cap THEN
        RAISE EXCEPTION 'limit of % rows in % reached for this user', cap, TG_TABLE_NAME
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memories_cap  BEFORE INSERT ON memories
    FOR EACH ROW EXECUTE FUNCTION enforce_row_cap('30');
CREATE TRIGGER interests_cap BEFORE INSERT ON interests
    FOR EACH ROW EXECUTE FUNCTION enforce_row_cap('5');

-- ---------------------------------------------------------------------------
-- Chat (7-day retention)
-- ---------------------------------------------------------------------------

CREATE TABLE chats (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    birth_profile_id uuid        REFERENCES birth_profiles(id) ON DELETE SET NULL,
    title            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_message_at  timestamptz NOT NULL DEFAULT now(),
    -- Set by the application from the user's tier, so lifting the limit for
    -- paid users is a value change rather than a schema change.
    expires_at       timestamptz NOT NULL
);

CREATE INDEX chats_user_idx    ON chats (user_id, last_message_at DESC);
CREATE INDEX chats_expiry_idx  ON chats (expires_at);

CREATE TABLE chat_messages (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id     uuid        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        chat_role   NOT NULL,
    content     text        NOT NULL,
    token_count int,
    -- Which computed facts this turn was grounded in. Lets a reply be audited
    -- without recomputing, and expires with the chat.
    context_ref jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_chat_idx ON chat_messages (chat_id, created_at);

-- Context compaction. When a chat outgrows the model window, older messages
-- collapse into a summary and the originals are removed; `through_message_at`
-- records where the summary ends so the two never overlap or leave a gap.
CREATE TABLE chat_summaries (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id            uuid        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    summary            text        NOT NULL,
    through_message_at timestamptz NOT NULL,
    token_count        int,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_summaries_chat_idx ON chat_summaries (chat_id, through_message_at);

-- ---------------------------------------------------------------------------
-- Daily compass
-- ---------------------------------------------------------------------------

-- Keyed by chart and local date, not by user and timestamp: the compass is a
-- function of the chart and the day, so two requests on the same day must
-- return the same answer, and it can be computed lazily on first open rather
-- than by a nightly job over the whole user base.
CREATE TABLE daily_compass (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    birth_profile_id uuid        NOT NULL REFERENCES birth_profiles(id) ON DELETE CASCADE,
    local_date       date        NOT NULL,
    payload          jsonb       NOT NULL,
    model            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (birth_profile_id, local_date)
);

-- ---------------------------------------------------------------------------
-- Metering and observability
-- ---------------------------------------------------------------------------

-- Written on every model call, at the point where the user id is already in
-- hand. This is the table a paywall bills from, so it records provider-reported
-- token counts rather than an estimate.
CREATE TABLE llm_calls (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        REFERENCES users(id) ON DELETE SET NULL,
    chat_id           uuid        REFERENCES chats(id) ON DELETE SET NULL,
    purpose           llm_purpose NOT NULL,
    provider          text        NOT NULL DEFAULT 'openrouter',
    model             text        NOT NULL,
    prompt_tokens     int,
    completion_tokens int,
    cost_usd          numeric(12,6),
    latency_ms        int,
    ok                boolean     NOT NULL DEFAULT true,
    error_code        text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX llm_calls_user_time_idx ON llm_calls (user_id, created_at DESC);

-- Retrieval log. Holds a hash of the query and the verses that came back, never
-- the query text: it answers "did retrieval work" and "which passages informed
-- this reading" without retaining what the user asked.
CREATE TABLE rag_calls (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    llm_call_id  uuid        REFERENCES llm_calls(id) ON DELETE SET NULL,
    user_id      uuid        REFERENCES users(id) ON DELETE SET NULL,
    query_hash   bytea       NOT NULL,
    collection   text        NOT NULL,
    top_k        int         NOT NULL,
    -- [{ id, score, chapter, verse }, ...] — citable, and small.
    results      jsonb       NOT NULL,
    latency_ms   int,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rag_calls_user_time_idx ON rag_calls (user_id, created_at DESC);

-- Rate limiting and quota. Replaces the JSON file, whose read-modify-write
-- cycle loses increments when two requests overlap. Callers increment with
--   INSERT ... ON CONFLICT (user_id, period_start, kind)
--   DO UPDATE SET count = usage_counters.count + 1 RETURNING count;
-- which is atomic and returns the post-increment value in one round trip.
CREATE TABLE usage_counters (
    user_id      uuid       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start date       NOT NULL,
    kind         usage_kind NOT NULL,
    count        int        NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, period_start, kind)
);

COMMIT;
