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
