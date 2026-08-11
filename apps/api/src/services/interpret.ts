import type { Env } from '../config/env.js';
import type { Sql } from '../db/client.js';
import type { Tier } from '@horamind/shared';

import * as openrouter from '../lib/openrouter.js';
import * as rag from './rag.js';
import { upstreamFailure } from '../lib/errors.js';

/**
 * The interpretation loop.
 *
 * A model call, any tool calls it asks for, and a final answer — with every
 * round metered. The only tool exposed is retrieval: the chart is already in
 * context, so there is nothing else worth asking for, and a narrow tool surface
 * is a narrow surface for a model to misuse.
 */

/** Free-tier models are shared and throttled; a paid model is not. */
export function modelFor(env: Env, tier: Tier): string {
    return tier === 'free' ? env.OPENROUTER_MODEL_FREE : env.OPENROUTER_MODEL_PAID;
}

/**
 * Bounded, and low. Each iteration is a paid round trip, and a model that has
 * not answered after three searches is not converging — it is looping. Ending
 * with what it has produces a worse answer; ending after ten produces the same
 * worse answer and a bill.
 */
const MAX_TOOL_ROUNDS = 3;

const SEARCH_TOOL: openrouter.ToolDefinition = {
    type: 'function',
    function: {
        name: 'search_classical_texts',
        description:
            'Search Brihat Parashara Hora Shastra for the wording of a classical rule. '
            + 'Use it for a specific placement, dasha combination or yoga you are about to '
            + 'rely on. Do not use it for facts already in the computed context.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        'Name the entities involved, e.g. "Rahu ninth house effects" or '
                        + '"Saturn Mahadasha Jupiter Antardasha". Vague questions retrieve nothing useful.',
                },
            },
            required: ['query'],
        },
    },
};

export interface Citation {
    source: string | null;
    chapter: number | null;
    verse: string | null;
}

export interface InterpretResult {
    answer: string;
    citations: Citation[];
    model: string;
    usage: openrouter.Usage;
    generationId: string | null;
    toolRounds: number;
    latencyMs: number;
}

export interface InterpretOptions {
    env: Env;
    sql: Sql;
    userId: string;
    tier: Tier;
    messages: openrouter.ChatMessage[];
    /** Aborts the whole exchange, tool rounds included. */
    signal?: AbortSignal;
    onLlmCall?: (call: {
        model: string;
        usage: openrouter.Usage;
        generationId: string | null;
        latencyMs: number;
        ok: boolean;
    }) => Promise<void> | void;
}

/**
 * Run one interpretation to completion.
 *
 * Every model call is reported through `onLlmCall`, including the intermediate
 * ones that only decided to search. Metering just the final call would
 * understate cost by however many tool rounds happened — which is exactly the
 * kind of quiet under-counting that makes a paywall lose money.
 */
export async function interpret(opts: InterpretOptions): Promise<InterpretResult> {
    const started = Date.now();
    const model = modelFor(opts.env, opts.tier);
    const messages = [...opts.messages];

    const citations: Citation[] = [];
    const total: openrouter.Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastGenerationId: string | null = null;
    let rounds = 0;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const isFinalRound = round === MAX_TOOL_ROUNDS;

        const result = await openrouter.complete(opts.env, {
            model,
            messages,
            // Withhold the tool on the last permitted round. Offering it and
            // then refusing to run it would waste the round on a tool call that
            // can never be answered.
            tools: isFinalRound ? undefined : [SEARCH_TOOL],
            signal: opts.signal,
        });

        total.promptTokens += result.usage.promptTokens;
        total.completionTokens += result.usage.completionTokens;
        total.totalTokens += result.usage.totalTokens;
        lastGenerationId = result.generationId ?? lastGenerationId;

        await opts.onLlmCall?.({
            model: result.model,
            usage: result.usage,
            generationId: result.generationId,
            latencyMs: result.latencyMs,
            ok: true,
        });

        if (!result.toolCalls.length) {
            if (!result.content) {
                throw upstreamFailure('The model returned an empty response');
            }
            return {
                answer: result.content,
                citations,
                model: result.model,
                usage: total,
                generationId: lastGenerationId,
                toolRounds: rounds,
                latencyMs: Date.now() - started,
            };
        }

        rounds++;

        // The assistant turn carrying the tool calls must be replayed verbatim,
        // and every call must get a matching `tool` message. A missing pair is
        // a 400 from the provider, not a degraded answer.
        messages.push({
            role: 'assistant',
            content: result.content,
            tool_calls: result.toolCalls,
        });

        for (const call of result.toolCalls) {
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                name: call.function.name,
                content: await runTool(opts, call, citations),
            });
        }
    }

    throw upstreamFailure('The model did not settle on an answer');
}

/**
 * Execute one tool call.
 *
 * Failures are returned to the model as text rather than thrown. A retrieval
 * outage should degrade the reading to what the chart alone supports, not
 * abandon a request the user has already been charged for.
 */
async function runTool(
    opts: InterpretOptions,
    call: openrouter.ToolCall,
    citations: Citation[],
): Promise<string> {
    if (call.function.name !== 'search_classical_texts') {
        return `Error: no such tool "${call.function.name}".`;
    }

    let query: string;
    try {
        const args = JSON.parse(call.function.arguments) as { query?: unknown };
        if (typeof args.query !== 'string' || args.query.trim().length < 3) {
            return 'Error: "query" must be a string of at least three characters.';
        }
        query = args.query.trim();
    } catch {
        // Models do occasionally emit malformed JSON. Saying so lets it retry
        // on the next round instead of failing the whole interpretation.
        return 'Error: tool arguments were not valid JSON. Send {"query": "..."}.';
    }

    try {
        const found = await rag.query(opts.env, query, 4);

        if (!found.hits.length) {
            return 'No matching passages. Rely on the computed chart facts, and say so.';
        }

        for (const hit of found.hits) {
            citations.push({ source: hit.source, chapter: hit.chapter, verse: hit.verse });
        }

        return found.hits
            .map((h, i) => {
                const ref = [h.source, h.chapter ? `Ch. ${h.chapter}` : null,
                             h.verse ? `v. ${h.verse}` : null].filter(Boolean).join(', ');
                return `[${i + 1}] ${ref || 'BPHS'}\n${h.document}`;
            })
            .join('\n\n');
    } catch (err) {
        return 'The classical text search is unavailable. Answer from the computed chart '
             + 'facts alone, and tell the user you could not consult the texts.';
    }
}
