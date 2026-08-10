-- Weekly interest prompt.
--
-- Interests are asked for, not inferred. A weekly overlay — anchored to the
-- user's own onboarding date rather than a global Monday, so the load spreads
-- naturally across the week — invites them to say what is on their mind.
--
-- This replaces the original plan of deriving interests from chat text. Asking
-- is better on two counts: the answer is what the user actually meant rather
-- than what a model guessed, and nothing needs to read conversations, so the
-- privacy claim stays unqualified.
--
-- Users can skip a single prompt or opt out permanently. Opting out costs them
-- personalisation, which the UI should say plainly rather than burying.

BEGIN;

ALTER TABLE users
    -- When the next overlay is due. NULL means "never ask", set either by the
    -- opt-out below or by an operator.
    ADD COLUMN interests_prompt_due_at timestamptz,
    -- Deliberate, permanent opt-out. Kept separate from `due_at` so that
    -- "asked to be left alone" is distinguishable from "not scheduled yet".
    ADD COLUMN interests_prompt_opted_out boolean NOT NULL DEFAULT false,
    -- Onboarding is the anchor for the weekly cycle. Distinct from created_at:
    -- an account can exist before its owner has finished setting it up.
    ADD COLUMN onboarded_at timestamptz;

-- Only ever scanned for users who are actually due, so the index carries just
-- those rows rather than the whole table.
CREATE INDEX users_interests_due_idx ON users (interests_prompt_due_at)
    WHERE interests_prompt_due_at IS NOT NULL AND interests_prompt_opted_out = false;

/**
 * Record that the prompt was shown, and schedule the next one.
 *
 * `answered` distinguishes engagement from dismissal. Both push the next prompt
 * out by a week — a user who skips is not asked again tomorrow — but the
 * distinction is worth recording, because a run of skips is the signal that the
 * overlay is unwelcome and should stop being shown at all.
 */
CREATE OR REPLACE FUNCTION record_interest_prompt(
    p_user_id uuid,
    p_answered boolean
) RETURNS timestamptz AS $$
DECLARE
    next_due timestamptz;
BEGIN
    next_due := now() + interval '7 days';
    UPDATE users
       SET interests_prompt_due_at = next_due,
           updated_at = now()
     WHERE id = p_user_id
       AND interests_prompt_opted_out = false;

    -- Silence the unused-parameter warning while keeping `answered` in the
    -- signature: callers already pass it, and the column it will populate is a
    -- follow-up rather than a reason to change every call site later.
    PERFORM p_answered;

    RETURN next_due;
END;
$$ LANGUAGE plpgsql;

COMMIT;
