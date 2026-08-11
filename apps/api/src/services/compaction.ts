import type { Env } from '../config/env.js';
import type { Sql } from '../db/client.js';
import type { Tier } from '@horamind/shared';

import * as chats from '../repos/chats.js';
import * as openrouter from '../lib/openrouter.js';
import { modelFor } from './interpret.js';

/**
 * Context compaction.
 *
 * A chat that outgrows the model's window has to lose something. The choice is
 * between dropping the oldest messages outright and summarising them; dropping
 * is cheaper and produces an assistant that forgets what the user said four
 * turns ago while continuing confidently — which reads as the model not
 * listening.
 *
 * So the oldest run is summarised into `chat_summaries`, the originals are
 * deleted, and the summary is prepended as a system message on later turns.
 * Deleting the originals is deliberate: keeping them would mean the same text
 * counted twice, and would quietly defeat the 7-day retention promise by
 * leaving copies around.
 */

/**
 * Rough token estimate.
 *
 * ~4 characters per token for English. Deliberately an approximation: a real
 * tokeniser would mean shipping the model's vocabulary, and the number is only
 * used to decide *when* to compact. Being 15% out moves the trigger point
 * slightly; it does not make anything incorrect.
 *
 * Erring high is the safe direction — compacting a little early costs one extra
 * summary, while compacting late means the provider rejects the request.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.6);
}

export function estimateMessageTokens(messages: Array<{ content: string | null }>): number {
    // Each message carries role and delimiter overhead beyond its text.
    return messages.reduce((sum, m) => sum + estimateTokens(m.content ?? '') + 4, 0);
}

/**
 * Compact when the conversation passes this share of the working budget.
 *
 * 0.6 rather than something closer to 1.0 because the conversation is only part
 * of the prompt: the instruction files, the computed facts and any retrieved
 * passages all have to fit alongside it, and the reply needs room too.
 */
const COMPACT_AT = 0.6;

/** Conservative working budget. Free-tier models are commonly 8k. */
const DEFAULT_BUDGET_TOKENS = 8_000;

/** Keep this many recent turns verbatim, whatever else is summarised. */
const KEEP_RECENT = 6;

export interface CompactionResult {
    compacted: boolean;
    messagesRemoved: number;
    summaryTokens: number;
}

/**
 * Compact a chat if it has grown too large.
 *
 * Returns without a model call when nothing needs doing, which is the common
 * case — summarising is itself a paid completion and must not run on every turn.
 */
export async function compactIfNeeded(
    env: Env,
    sql: Sql,
    chatId: string,
    tier: Tier,
    budgetTokens = DEFAULT_BUDGET_TOKENS,
): Promise<CompactionResult> {
    const messages = await chats.listMessages(sql, chatId);
    const existing = await chats.latestSummary(sql, chatId);

    const used = estimateMessageTokens(messages)
        + (existing ? estimateTokens(existing.summary) : 0);

    if (used < budgetTokens * COMPACT_AT) {
        return { compacted: false, messagesRemoved: 0, summaryTokens: 0 };
    }

    // Never summarise the recent turns — they are what the user is actually
    // talking about, and paraphrasing the immediately preceding question makes
    // the assistant appear to have misheard it.
    const olderThanRecent = messages.slice(0, Math.max(0, messages.length - KEEP_RECENT));
    if (olderThanRecent.length < 2) {
        return { compacted: false, messagesRemoved: 0, summaryTokens: 0 };
    }

    const transcript = olderThanRecent
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${m.role === 'user' ? 'User' : 'Astrologer'}: ${m.content}`)
        .join('\n\n');

    const prior = existing ? `Summary of even earlier turns:\n${existing.summary}\n\n` : '';

    const result = await openrouter.complete(env, {
        model: modelFor(env, tier),
        temperature: 0.1,
        maxTokens: 500,
        messages: [
            {
                role: 'system',
                content:
                    'Summarise this astrology consultation so it can stand in for the original '
                    + 'transcript.\n\n'
                    + 'Keep: what the user asked about, the specific life circumstances they '
                    + 'disclosed, which chart factors were cited, and any conclusion reached.\n\n'
                    + 'Drop: pleasantries, restatements, and anything the user can see in their '
                    + 'own chart.\n\n'
                    + 'Write in the third person. Never invent a detail that is not in the '
                    + 'transcript — a summary that adds something is worse than one that is '
                    + 'short, because the model reading it later cannot tell the difference.',
            },
            { role: 'user', content: `${prior}Transcript:\n\n${transcript}` },
        ],
    });

    if (!result.content) {
        // Better to carry an oversized context for one more turn than to delete
        // the conversation and replace it with nothing.
        return { compacted: false, messagesRemoved: 0, summaryTokens: 0 };
    }

    const through = olderThanRecent[olderThanRecent.length - 1]!.createdAt;
    const removed = await chats.compact(
        sql, chatId, result.content, through, estimateTokens(result.content),
    );

    return {
        compacted: true,
        messagesRemoved: removed,
        summaryTokens: estimateTokens(result.content),
    };
}
