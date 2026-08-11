import type { Sql } from '../db/client.js';
import { TIER_LIMITS, type Tier } from '@horamind/shared';

/**
 * Chat persistence.
 *
 * Chats expire. `expires_at` is stored on the row rather than derived at read
 * time, so lifting the limit for a paid tier is a value change rather than a
 * schema change — and so a chat's fate is visible in the data instead of being
 * implied by whatever the code happens to compute today.
 */

export interface ChatRow {
    id: string;
    userId: string;
    birthProfileId: string | null;
    title: string | null;
    createdAt: Date;
    lastMessageAt: Date;
    expiresAt: Date;
}

export interface MessageRow {
    id: string;
    chatId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tokenCount: number | null;
    contextRef: unknown;
    createdAt: Date;
}

export async function createChat(
    sql: Sql,
    userId: string,
    tier: Tier,
    birthProfileId: string | null,
    title: string | null,
): Promise<ChatRow> {
    const days = TIER_LIMITS[tier].chatRetentionDays;
    const [row] = await sql<ChatRow[]>`
        INSERT INTO chats (user_id, birth_profile_id, title, expires_at)
        VALUES (${userId}, ${birthProfileId}, ${title},
                now() + ${`${days} days`}::interval)
        RETURNING id, user_id, birth_profile_id, title, created_at, last_message_at, expires_at`;
    if (!row) throw new Error('Chat insert returned no row');
    return row;
}

/** Live chats only. An expired one is about to be deleted; showing it is a lie. */
export async function listChats(sql: Sql, userId: string): Promise<Array<ChatRow & { messageCount: number }>> {
    return sql<Array<ChatRow & { messageCount: number }>>`
        SELECT c.id, c.user_id, c.birth_profile_id, c.title,
               c.created_at, c.last_message_at, c.expires_at,
               (SELECT count(*)::int FROM chat_messages m WHERE m.chat_id = c.id) AS message_count
          FROM chats c
         WHERE c.user_id = ${userId} AND c.expires_at > now()
         ORDER BY c.last_message_at DESC`;
}

export async function findChat(sql: Sql, userId: string, id: string): Promise<ChatRow | null> {
    const [row] = await sql<ChatRow[]>`
        SELECT id, user_id, birth_profile_id, title, created_at, last_message_at, expires_at
          FROM chats
         WHERE id = ${id} AND user_id = ${userId} AND expires_at > now()`;
    return row ?? null;
}

export async function deleteChat(sql: Sql, userId: string, id: string): Promise<boolean> {
    // Messages and summaries cascade, so the text goes with it.
    const rows = await sql`DELETE FROM chats WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
}

export async function addMessage(
    sql: Sql,
    chatId: string,
    role: MessageRow['role'],
    content: string,
    tokenCount: number | null,
    contextRef: unknown = null,
): Promise<MessageRow> {
    return sql.begin(async tx => {
        const [row] = await tx<MessageRow[]>`
            INSERT INTO chat_messages (chat_id, role, content, token_count, context_ref)
            VALUES (${chatId}, ${role}, ${content}, ${tokenCount},
                    ${contextRef === null ? null : tx.json(contextRef as never)})
            RETURNING id, chat_id, role, content, token_count, context_ref, created_at`;
        // Drives the chat list ordering, so it has to move with the message
        // rather than being refreshed by a separate call that might not happen.
        await tx`UPDATE chats SET last_message_at = now() WHERE id = ${chatId}`;
        if (!row) throw new Error('Message insert returned no row');
        return row;
    }) as Promise<MessageRow>;
}

/**
 * Messages still in full form.
 *
 * Anything older than the newest summary has been compacted away and deleted,
 * so this returns only what the summary does not already cover.
 */
export async function listMessages(sql: Sql, chatId: string): Promise<MessageRow[]> {
    return sql<MessageRow[]>`
        SELECT id, chat_id, role, content, token_count, context_ref, created_at
          FROM chat_messages
         WHERE chat_id = ${chatId}
         ORDER BY created_at`;
}

export interface SummaryRow {
    id: string;
    chatId: string;
    summary: string;
    throughMessageAt: Date;
    tokenCount: number | null;
}

/** The most recent summary, which supersedes any earlier one. */
export async function latestSummary(sql: Sql, chatId: string): Promise<SummaryRow | null> {
    const [row] = await sql<SummaryRow[]>`
        SELECT id, chat_id, summary, through_message_at, token_count
          FROM chat_summaries
         WHERE chat_id = ${chatId}
         ORDER BY through_message_at DESC
         LIMIT 1`;
    return row ?? null;
}

/**
 * Replace a run of messages with a summary.
 *
 * Both halves happen in one transaction. Writing the summary and then failing
 * to delete would double-count the history on the next turn; deleting first and
 * then failing would lose the conversation outright.
 */
export async function compact(
    sql: Sql,
    chatId: string,
    summary: string,
    throughMessageAt: Date,
    tokenCount: number,
): Promise<number> {
    return sql.begin(async tx => {
        await tx`
            INSERT INTO chat_summaries (chat_id, summary, through_message_at, token_count)
            VALUES (${chatId}, ${summary}, ${throughMessageAt}, ${tokenCount})`;

        const removed = await tx`
            DELETE FROM chat_messages
             WHERE chat_id = ${chatId} AND created_at <= ${throughMessageAt}
            RETURNING id`;

        return removed.length;
    }) as Promise<number>;
}

/** Chats about to expire, for warning a user before their history disappears. */
export async function expiringSoon(
    sql: Sql,
    userId: string,
    withinHours = 24,
): Promise<ChatRow[]> {
    return sql<ChatRow[]>`
        SELECT id, user_id, birth_profile_id, title, created_at, last_message_at, expires_at
          FROM chats
         WHERE user_id = ${userId}
           AND expires_at > now()
           AND expires_at < now() + ${`${withinHours} hours`}::interval
         ORDER BY expires_at`;
}
