import type { Sql } from '../db/client.js';
import { TIER_LIMITS, type Tier } from '@horamind/shared';
import { quotaExceeded } from '../lib/errors.js';

/**
 * Per-user quota.
 *
 * This replaces `rate_limits.json` from the Telegram agent, which read the file,
 * incremented in memory and wrote it back. Two overlapping requests both read
 * the same starting value and one increment was lost — so the limit was
 * routinely exceeded, silently, exactly when the service was busiest.
 *
 * The upsert below is a single atomic statement. Postgres serialises the
 * conflicting writers and each gets its own post-increment value back.
 */

export type UsageKind = 'chat_message' | 'compass' | 'reading' | 'rag_query';

export interface QuotaState {
    used: number;
    limit: number;
    remaining: number;
}

function limitFor(tier: Tier, kind: UsageKind): number {
    const limits = TIER_LIMITS[tier];
    switch (kind) {
        case 'chat_message': return limits.chatMessagesPerDay;
        case 'compass':      return limits.compassPerDay;
        // Readings and retrieval ride along with chat rather than carrying
        // their own budget; one question can legitimately trigger several.
        case 'reading':      return limits.chatMessagesPerDay;
        case 'rag_query':    return limits.chatMessagesPerDay * 3;
    }
}

/**
 * The day boundary, in the *user's* timezone.
 *
 * A quota that resets at server midnight resets in the middle of the afternoon
 * for someone in another hemisphere. Computed here rather than in SQL so the
 * zone travels with the user record.
 */
export function periodStart(timezone: string, now = new Date()): string {
    try {
        // en-CA formats as YYYY-MM-DD, which is exactly what `date` wants.
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
    } catch {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(now);
    }
}

/**
 * Consume one unit of quota, atomically.
 *
 * Increments first and rejects afterwards if the limit is passed. The reverse
 * order — check, then increment — is the classic race: two requests both read
 * a value under the limit and both proceed.
 */
export async function consume(
    sql: Sql,
    userId: string,
    tier: Tier,
    kind: UsageKind,
    timezone: string,
): Promise<QuotaState> {
    const limit = limitFor(tier, kind);
    const day = periodStart(timezone);

    const [row] = await sql<{ count: number }[]>`
        INSERT INTO usage_counters (user_id, period_start, kind, count)
        VALUES (${userId}, ${day}, ${kind}, 1)
        ON CONFLICT (user_id, period_start, kind)
        DO UPDATE SET count = usage_counters.count + 1
        RETURNING count`;

    const used = row?.count ?? 1;

    if (used > limit) {
        throw quotaExceeded(
            `You have used your ${limit} ${kind.replace('_', ' ')} for today`,
            { limit, used: limit, resetsAt: `${day} 24:00 ${timezone}` },
        );
    }

    return { used, limit, remaining: Math.max(0, limit - used) };
}

/** Read the current state without consuming. For showing "3 of 20 left". */
export async function peek(
    sql: Sql,
    userId: string,
    tier: Tier,
    kind: UsageKind,
    timezone: string,
): Promise<QuotaState> {
    const limit = limitFor(tier, kind);
    const [row] = await sql<{ count: number }[]>`
        SELECT count FROM usage_counters
         WHERE user_id = ${userId}
           AND period_start = ${periodStart(timezone)}
           AND kind = ${kind}`;

    const used = row?.count ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Give back a unit after an upstream failure.
 *
 * If the model call fails, the user got nothing and should not be charged for
 * it. Floored at zero so a double refund cannot mint quota.
 */
export async function refund(
    sql: Sql,
    userId: string,
    kind: UsageKind,
    timezone: string,
): Promise<void> {
    await sql`
        UPDATE usage_counters
           SET count = GREATEST(0, count - 1)
         WHERE user_id = ${userId}
           AND period_start = ${periodStart(timezone)}
           AND kind = ${kind}`;
}
