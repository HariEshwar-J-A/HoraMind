import type { Env } from '../config/env.js';
import { upstreamFailure, serviceUnavailable, badRequest } from './errors.js';

/**
 * OpenRouter client.
 *
 * Written against `fetch` rather than pulled from an SDK, for three reasons
 * that all matter here:
 *
 *   - OpenRouter is OpenAI-compatible, so the whole integration is a base URL
 *     and a header. An SDK would add a dependency to save about forty lines.
 *   - Token accounting is what the paywall bills from. Reading `usage`
 *     directly at the call site, where the user id is already in hand, keeps
 *     billing and reality in the same place.
 *   - No framework. LangChain's main draw is multi-provider abstraction, which
 *     is precisely what OpenRouter already sells.
 */

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface Usage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface CompletionResult {
    content: string | null;
    toolCalls: ToolCall[];
    finishReason: string;
    model: string;
    usage: Usage;
    /** OpenRouter's generation id, which the cost endpoint is keyed by. */
    generationId: string | null;
    latencyMs: number;
}

interface OpenRouterChoice {
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string;
}

interface OpenRouterResponse {
    id?: string;
    model?: string;
    choices?: OpenRouterChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    error?: { message?: string; code?: number };
}

export interface CompletionRequest {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
}

/**
 * Attribution headers.
 *
 * OpenRouter uses these for its model-usage rankings and, more practically, to
 * identify traffic when a key is rate-limited or abused. Sending them makes a
 * support conversation possible.
 */
function headers(env: Env): Record<string, string> {
    if (!env.OPENROUTER_API_KEY) {
        throw serviceUnavailable('AI features are not configured on this server');
    }
    return {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.PUBLIC_BASE_URL,
        'X-Title': 'HoraMind',
    };
}

export async function complete(env: Env, req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();

    // Built before the try. Inside it, a missing API key would be caught and
    // re-reported as "could not reach OpenRouter" — sending an operator to
    // debug the network when the actual fault is an empty environment variable.
    const authHeaders = headers(env);

    let res: Response;
    try {
        res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: authHeaders,
            signal: req.signal,
            body: JSON.stringify({
                model: req.model,
                messages: req.messages,
                tools: req.tools,
                temperature: req.temperature ?? 0.4,
                max_tokens: req.maxTokens ?? 1500,
                // Ask for usage even on streamed responses; without it the
                // metering row would be written with nulls.
                usage: { include: true },
            }),
        });
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            throw upstreamFailure('The model took too long to respond');
        }
        throw upstreamFailure('Could not reach OpenRouter', {
            cause: err instanceof Error ? err.message : String(err),
        });
    }

    const body = await res.json().catch(() => null) as OpenRouterResponse | null;

    if (!res.ok || body?.error) {
        const message = body?.error?.message ?? `HTTP ${res.status}`;

        // Free-tier models are shared and rate-limited. Distinguishing this
        // from a generic failure lets the caller fall back to another model
        // rather than telling the user something went wrong.
        if (res.status === 429) {
            throw upstreamFailure(`Model is rate limited: ${message}`, { retryable: true });
        }
        if (res.status === 402) {
            throw upstreamFailure('The AI account is out of credit', { retryable: false });
        }
        if (res.status === 400) {
            throw badRequest(`The model rejected the request: ${message}`);
        }
        throw upstreamFailure(`OpenRouter error: ${message}`);
    }

    const choice = body?.choices?.[0];

    return {
        content: choice?.message?.content ?? null,
        toolCalls: choice?.message?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? 'unknown',
        model: body?.model ?? req.model,
        usage: {
            promptTokens: body?.usage?.prompt_tokens ?? 0,
            completionTokens: body?.usage?.completion_tokens ?? 0,
            totalTokens: body?.usage?.total_tokens ?? 0,
        },
        generationId: body?.id ?? null,
        latencyMs: Date.now() - started,
    };
}

/**
 * Exact cost for a completed generation.
 *
 * Deliberately separate and best-effort. OpenRouter computes cost
 * asynchronously, so this is not available at completion time, and a billing
 * lookup must never fail a user's reading. Callers record token counts
 * immediately and reconcile cost afterwards.
 */
export async function fetchCost(env: Env, generationId: string): Promise<number | null> {
    try {
        const res = await fetch(`${env.OPENROUTER_BASE_URL}/generation?id=${generationId}`, {
            headers: headers(env),
        });
        if (!res.ok) return null;
        const body = await res.json() as { data?: { total_cost?: number } };
        return typeof body?.data?.total_cost === 'number' ? body.data.total_cost : null;
    } catch {
        return null;
    }
}
