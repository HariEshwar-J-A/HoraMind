import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChatMessage } from '../lib/openrouter.js';
import type { Memory, Interest } from '@horamind/shared';

/**
 * Prompt assembly.
 *
 * The instruction set lives in Markdown under `agent_config/`, not in string
 * literals here. Three files, each answering a different question:
 *
 *   agent.md               who the assistant is, its voice, and its limits
 *   skill.md               how to read the computed context it receives
 *   prediction-method.md   the classical rules and the Conflict Resolution
 *                          Matrix — carried over unchanged from the Telegram
 *                          agent, where it was already the most considered part
 *
 * Keeping them as files means the interpretive stance can be revised by editing
 * prose and restarting, rather than by changing code and redeploying. It also
 * makes the diff of a behaviour change readable by someone who knows Jyotish
 * and not TypeScript.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Walk up to the repository root.
 *
 * `agent_config/` sits beside `apps/`, and this file resolves differently under
 * `src/` in development and `dist/` in the container. Probing upward is more
 * robust than counting `..` segments and getting a different answer in each.
 */
async function findConfigDir(): Promise<string> {
    let dir = HERE;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, 'agent_config');
        try {
            await readFile(path.join(candidate, 'agent.md'), 'utf8');
            return candidate;
        } catch {
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    throw new Error('agent_config/ not found — the instruction files are missing from the image');
}

let cached: string | null = null;

/**
 * Load and concatenate the instruction files.
 *
 * Cached for the process lifetime: they are read on every interpretation, and
 * re-reading three files per request buys nothing. A restart picks up edits.
 */
export async function systemInstructions(): Promise<string> {
    if (cached) return cached;

    const dir = await findConfigDir();
    const parts: string[] = [];

    for (const file of ['agent.md', 'skill.md', 'prediction-method.md']) {
        try {
            parts.push(await readFile(path.join(dir, file), 'utf8'));
        } catch {
            // A missing optional file degrades the reading rather than breaking
            // it; a missing agent.md was already caught by findConfigDir.
            if (file === 'agent.md') throw new Error(`Required instruction file missing: ${file}`);
        }
    }

    cached = parts.join('\n\n---\n\n');
    return cached;
}

export function resetInstructionCache(): void {
    cached = null;
}

/**
 * Render the user's saved memories.
 *
 * "What I learnt" comes last and is labelled, because it is the part that
 * should steer advice — the other fields are context for it.
 */
export function renderMemories(memories: Memory[]): string {
    if (!memories.length) return '';

    const lines = memories.map(m => {
        const when = m.occurredOn ?? 'date not given';
        const bits = [`- [${when}] ${m.whatHappened}`];
        if (m.howItAffected) bits.push(`  Effect on them: ${m.howItAffected}`);
        if (m.whatILearnt) bits.push(`  What they learnt: ${m.whatILearnt}`);
        return bits.join('\n');
    });

    return `## The user's recorded memories\n\n${lines.join('\n')}\n\n`
        + 'Use these to calibrate, not to flatter. Never invent one, and never '
        + 'imply knowledge of anything not listed here.';
}

export function renderInterests(interests: Interest[]): string {
    if (!interests.length) return '';
    const list = interests
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .map(i => i.label)
        .join(', ');
    return `## What the user says they care about\n\n${list}\n\n`
        + 'Lead with these rather than surveying every house.';
}

/**
 * Render computed facts as JSON.
 *
 * Deliberately not prose. These are measurements, and a model handed
 * `"longitude": 84.511003` is far less likely to drift than one handed
 * "the Moon sits at about 24 degrees of Gemini". Prose invites paraphrase;
 * numbers do not.
 */
export function renderFacts(facts: unknown): string {
    return '## Computed facts for this chart\n\n'
        + 'These are measurements from a verified ephemeris. Do not adjust, round '
        + 'or reinterpret them.\n\n```json\n'
        + JSON.stringify(facts, null, 2)
        + '\n```';
}

export interface AssembleInput {
    facts: unknown;
    memories: Memory[];
    interests: Interest[];
    /** Compacted summary of earlier turns, when the chat has been compacted. */
    priorSummary?: string | null;
    history: ChatMessage[];
    question: string;
}

/**
 * Build the message array for one turn.
 *
 * Order is deliberate. Instructions first, then the facts, then who the user is,
 * then the conversation. A model attends most reliably to the start and the end
 * of its context, so the stable framing goes at the top and the live question at
 * the bottom.
 */
export async function assemble(input: AssembleInput): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [
        { role: 'system', content: await systemInstructions() },
        { role: 'system', content: renderFacts(input.facts) },
    ];

    const profile = [renderInterests(input.interests), renderMemories(input.memories)]
        .filter(Boolean)
        .join('\n\n');
    if (profile) messages.push({ role: 'system', content: profile });

    if (input.priorSummary) {
        messages.push({
            role: 'system',
            content: `## Earlier in this conversation\n\n${input.priorSummary}`,
        });
    }

    messages.push(...input.history);
    messages.push({ role: 'user', content: input.question });

    return messages;
}
