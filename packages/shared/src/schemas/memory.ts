import { z } from 'zod';
import { UuidSchema, IsoDateSchema } from './common.js';

/**
 * Memories and interests — the user's own account of their life, used to steer
 * interpretation.
 *
 * The four fields mirror the four questions the user is asked: when, what
 * happened, how it affected them, what they learnt. They are kept as separate
 * columns rather than one free-text blob because the prompt builder weights
 * them differently — "what I learnt" is the part that should shape advice,
 * while "what happened" is context.
 */

export const CreateMemorySchema = z.object({
    /** Optional: a user may remember that something happened without the date. */
    occurredOn:     IsoDateSchema.nullable().default(null),
    whatHappened:   z.string().min(1).max(2000),
    howItAffected:  z.string().max(2000).nullable().default(null),
    whatILearnt:    z.string().max(2000).nullable().default(null),
});

export const UpdateMemorySchema = CreateMemorySchema.partial();

export const MemorySchema = CreateMemorySchema.extend({
    id:        UuidSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Memory = z.infer<typeof MemorySchema>;

export const INTEREST_SOURCES = ['user', 'derived'] as const;

export const CreateInterestSchema = z.object({
    label:  z.string().min(1).max(80),
    /** How strongly this steers interpretation. Derived interests start lower. */
    weight: z.number().min(0).max(1).default(1),
});

export const InterestSchema = CreateInterestSchema.extend({
    id:          UuidSchema,
    source:      z.enum(INTEREST_SOURCES),
    refreshedAt: z.string(),
    createdAt:   z.string(),
});

export type Interest = z.infer<typeof InterestSchema>;

/**
 * The weekly interest prompt.
 *
 * Interests are asked for, never inferred from what the user types in chat.
 * That is a deliberate trade: a direct answer is what the user actually meant
 * rather than what a model guessed from their questions, and nothing has to
 * read conversations, so the privacy claim needs no asterisk.
 *
 * The cycle is anchored to each user's onboarding date rather than a shared
 * weekday, which also spreads the load instead of concentrating it on Mondays.
 */
export const InterestPromptStateSchema = z.object({
    /** Whether the client should show the overlay now. */
    due: z.boolean(),
    dueAt: z.string().nullable(),
    optedOut: z.boolean(),
    /** Current interests, so the overlay can prefill rather than start empty. */
    current: z.array(InterestSchema),
    remainingSlots: z.number().int().nonnegative(),
});

export const InterestPromptResponseSchema = z.object({
    /**
     * `answer` replaces the interest set; `skip` defers a week; `never` opts
     * out permanently. Kept as one endpoint so the client cannot leave the
     * prompt in a state where it is neither answered nor rescheduled and
     * therefore fires again on the next launch.
     */
    action: z.enum(['answer', 'skip', 'never']),
    interests: z.array(CreateInterestSchema).max(30).optional(),
});

export type InterestPromptState = z.infer<typeof InterestPromptStateSchema>;
