-- Life analysis: one long reading per profile, regenerated when its inputs move.
--
-- Stored rather than computed per request for two reasons. It is the most
-- expensive generation in the product — the whole natal chart, the full dasha
-- tree, every memory and interest — and it is the one a user returns to, so
-- re-deriving it on each open would mean paying again to show the same words.
--
-- `inputs_hash` is what makes "updated based on interests and memories" mean
-- something more disciplined than "regenerated whenever". It is a digest of the
-- exact material that fed the prompt, so a stale row is detected by comparing
-- hashes rather than by guessing from timestamps. Editing a memory's wording
-- changes the hash and earns a regeneration; opening the screen does not.

BEGIN;

CREATE TYPE life_analysis_status AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE life_analyses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    birth_profile_id uuid NOT NULL REFERENCES birth_profiles(id) ON DELETE CASCADE,

    status          life_analysis_status NOT NULL DEFAULT 'pending',

    -- Sections are stored as jsonb rather than one blob of prose so the client
    -- can render, reorder or collapse them without parsing paragraphs back out
    -- of a string.
    sections        jsonb,

    -- SHA-256 over the chart, dasha tree, memories and interests that produced
    -- this row. Bytea, not text: it is a digest, never displayed, and storing
    -- it as hex would double the width for no benefit.
    inputs_hash     bytea NOT NULL,

    model           text,
    error           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One analysis per profile. A regeneration replaces the row rather than adding
-- to it: nobody wants a history of readings they did not ask to keep, and the
-- retention promise in the README is easier to honour with one row than with a
-- growing list.
CREATE UNIQUE INDEX life_analyses_profile_uniq ON life_analyses (birth_profile_id);

CREATE INDEX life_analyses_user_idx ON life_analyses (user_id);

-- `updated_at` is set by the writing statement, not by a trigger. No table in
-- this schema uses one, and introducing the first here would mean two
-- conventions for the same column and a reader having to know which tables are
-- which.

COMMIT;
