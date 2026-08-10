import type { Sql } from '../db/client.js';
import type { Memory, Interest } from '@horamind/shared';
import { limitReached } from '../lib/errors.js';

/**
 * Memories and interests.
 *
 * Both are capped per user — 30 and 5 on the free tier — and both caps are
 * enforced by database triggers as well as here. The triggers are the real
 * guarantee: these limits exist to bound prompt size, so a bug that slipped
 * past an application check would show up as an OpenRouter bill rather than an
 * error. `check_violation` from the trigger is translated back into a clean
 * 409 below.
 */

const PG_CHECK_VIOLATION = '23514';

export interface MemoryRow {
    id: string;
    userId: string;
    occurredOn: string | null;
    whatHappened: string;
    howItAffected: string | null;
    whatILearnt: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export function toMemory(r: MemoryRow): Memory {
    return {
        id: r.id,
        occurredOn: r.occurredOn ? String(r.occurredOn).slice(0, 10) : null,
        whatHappened: r.whatHappened,
        howItAffected: r.howItAffected,
        whatILearnt: r.whatILearnt,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
    };
}

const MEMORY_COLS = `id, user_id, occurred_on, what_happened, how_it_affected,
                     what_i_learnt, created_at, updated_at`;

export async function listMemories(sql: Sql, userId: string): Promise<MemoryRow[]> {
    return sql<MemoryRow[]>`
        SELECT ${sql.unsafe(MEMORY_COLS)} FROM memories
         WHERE user_id = ${userId}
         ORDER BY occurred_on DESC NULLS LAST, created_at DESC`;
}

export async function countMemories(sql: Sql, userId: string): Promise<number> {
    const [row] = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM memories WHERE user_id = ${userId}`;
    return Number(row?.n ?? 0);
}

export async function createMemory(
    sql: Sql,
    userId: string,
    input: {
        occurredOn: string | null;
        whatHappened: string;
        howItAffected: string | null;
        whatILearnt: string | null;
    },
): Promise<MemoryRow> {
    try {
        const [row] = await sql<MemoryRow[]>`
            INSERT INTO memories (user_id, occurred_on, what_happened, how_it_affected, what_i_learnt)
            VALUES (${userId}, ${input.occurredOn}, ${input.whatHappened},
                    ${input.howItAffected}, ${input.whatILearnt})
            RETURNING ${sql.unsafe(MEMORY_COLS)}`;
        if (!row) throw new Error('Memory insert returned no row');
        return row;
    } catch (err) {
        // Translate the trigger's raise into the same 409 the API would have
        // produced itself, so clients see one behaviour regardless of which
        // layer caught it.
        if ((err as { code?: string }).code === PG_CHECK_VIOLATION) {
            throw limitReached('You have reached the maximum number of memories', { limit: 30 });
        }
        throw err;
    }
}

export async function updateMemory(
    sql: Sql,
    userId: string,
    id: string,
    patch: Partial<{
        occurredOn: string | null;
        whatHappened: string;
        howItAffected: string | null;
        whatILearnt: string | null;
    }>,
): Promise<MemoryRow | null> {
    const [row] = await sql<MemoryRow[]>`
        UPDATE memories SET
            occurred_on     = ${patch.occurredOn !== undefined ? patch.occurredOn : sql`occurred_on`},
            what_happened   = COALESCE(${patch.whatHappened ?? null}, what_happened),
            how_it_affected = ${patch.howItAffected !== undefined ? patch.howItAffected : sql`how_it_affected`},
            what_i_learnt   = ${patch.whatILearnt !== undefined ? patch.whatILearnt : sql`what_i_learnt`},
            updated_at      = now()
         WHERE id = ${id} AND user_id = ${userId}
        RETURNING ${sql.unsafe(MEMORY_COLS)}`;
    return row ?? null;
}

export async function deleteMemory(sql: Sql, userId: string, id: string): Promise<boolean> {
    const rows = await sql`
        DELETE FROM memories WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Interests
// ---------------------------------------------------------------------------

export interface InterestRow {
    id: string;
    userId: string;
    label: string;
    weight: number;
    source: 'user' | 'derived';
    refreshedAt: Date;
    createdAt: Date;
}

export function toInterest(r: InterestRow): Interest {
    return {
        id: r.id,
        label: r.label,
        weight: Number(r.weight),
        source: r.source,
        refreshedAt: r.refreshedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
    };
}

export async function listInterests(sql: Sql, userId: string): Promise<InterestRow[]> {
    return sql<InterestRow[]>`
        SELECT id, user_id, label, weight, source, refreshed_at, created_at
          FROM interests WHERE user_id = ${userId}
         ORDER BY weight DESC, created_at`;
}

/**
 * Replace the whole interest set.
 *
 * The weekly overlay hands back what the user wants now, which may drop
 * something they previously said. Replacing wholesale rather than merging is
 * what lets an interest actually go away — a merge would accumulate forever and
 * hit the cap with things the user had already moved on from.
 */
export async function replaceInterests(
    sql: Sql,
    userId: string,
    interests: Array<{ label: string; weight: number }>,
    max: number,
): Promise<InterestRow[]> {
    if (interests.length > max) {
        throw limitReached(`At most ${max} interests`, { limit: max });
    }

    // De-duplicate case-insensitively; the unique index is case-sensitive, and
    // "Career" plus "career" would otherwise consume two of five slots.
    const seen = new Set<string>();
    const unique = interests.filter(i => {
        const key = i.label.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return sql.begin(async tx => {
        await tx`DELETE FROM interests WHERE user_id = ${userId}`;
        const out: InterestRow[] = [];
        for (const i of unique) {
            const [row] = await tx<InterestRow[]>`
                INSERT INTO interests (user_id, label, weight, source)
                VALUES (${userId}, ${i.label.trim()}, ${i.weight}, 'user')
                RETURNING id, user_id, label, weight, source, refreshed_at, created_at`;
            if (row) out.push(row);
        }
        return out;
    }) as Promise<InterestRow[]>;
}

// ---------------------------------------------------------------------------
// Weekly prompt scheduling
// ---------------------------------------------------------------------------

export interface PromptState {
    dueAt: Date | null;
    optedOut: boolean;
    onboardedAt: Date | null;
}

export async function getPromptState(sql: Sql, userId: string): Promise<PromptState | null> {
    const [row] = await sql<PromptState[]>`
        SELECT interests_prompt_due_at AS "dueAt",
               interests_prompt_opted_out AS "optedOut",
               onboarded_at AS "onboardedAt"
          FROM users WHERE id = ${userId}`;
    return row ?? null;
}

/** Start the weekly cycle. Called once, when onboarding completes. */
export async function beginPromptCycle(sql: Sql, userId: string): Promise<void> {
    await sql`
        UPDATE users
           SET onboarded_at = COALESCE(onboarded_at, now()),
               interests_prompt_due_at = COALESCE(interests_prompt_due_at, now() + interval '7 days')
         WHERE id = ${userId}`;
}

export async function deferPrompt(sql: Sql, userId: string, answered: boolean): Promise<Date> {
    const [row] = await sql<{ nextDue: Date }[]>`
        SELECT record_interest_prompt(${userId}, ${answered}) AS "nextDue"`;
    return row!.nextDue;
}

/** Permanent opt-out. Costs personalisation, which the UI must say plainly. */
export async function optOutOfPrompt(sql: Sql, userId: string): Promise<void> {
    await sql`
        UPDATE users
           SET interests_prompt_opted_out = true,
               interests_prompt_due_at = NULL,
               updated_at = now()
         WHERE id = ${userId}`;
}
