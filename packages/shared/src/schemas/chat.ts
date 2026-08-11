import { z } from 'zod';
import { UuidSchema } from './common.js';

/**
 * Chat contracts.
 *
 * A chat has a finite life — 7 days on the free tier — after which it and every
 * message in it are permanently deleted. `expiresAt` is returned on every
 * response so the client can warn the user *before* the conversation
 * disappears. Silently deleting something a user valued is how an app earns
 * one-star reviews.
 */

export const CHAT_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export const ChatRoleSchema = z.enum(CHAT_ROLES);

export const CreateChatSchema = z.object({
    birthProfileId: UuidSchema.optional(),
    title:          z.string().max(120).optional(),
});

export const SendMessageSchema = z.object({
    content: z.string().min(1).max(4000),
    /**
     * The moment the question is about. Defaults to now, which is what an
     * interpretive question almost always means, but lets a user ask about a
     * specific date without rewording.
     */
    asOf:    z.string().datetime({ offset: true }).optional(),
    /** Server-sent events rather than a single response body. */
    stream:  z.boolean().default(true),
});

export const ChatMessageSchema = z.object({
    id:        UuidSchema,
    role:      ChatRoleSchema,
    content:   z.string(),
    createdAt: z.string(),
    /**
     * Which computed facts and retrieved verses this turn was grounded in.
     * Present on assistant turns so a reading can be audited — and so the app
     * can show its sources rather than asking to be believed.
     */
    grounding: z.object({
        dashaStack:  z.array(z.string()).optional(),
        citations:   z.array(z.object({
            // Nullable throughout: the corpus does not tag every chunk with a
            // source, chapter and verse, and a citation missing one of them is
            // still worth showing.
            source:  z.string().nullable(),
            chapter: z.number().nullable(),
            verse:   z.string().nullable(),
        })).optional(),
    }).nullable().optional(),
});

export const ChatSchema = z.object({
    id:             UuidSchema,
    title:          z.string().nullable(),
    birthProfileId: UuidSchema.nullable(),
    createdAt:      z.string(),
    lastMessageAt:  z.string(),
    /** Surfaced so the client can warn before permanent deletion. */
    expiresAt:      z.string(),
    messageCount:   z.number().int().nonnegative(),
});

export type Chat        = z.infer<typeof ChatSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * The daily compass: one day's guidance, derived mostly from computed facts
 * (Panchanga, Tarabala, Chandrabala, transit houses from the natal Moon, the
 * live dasha) with the model only phrasing them.
 */
export const CompassQuerySchema = z.object({
    birthProfileId: UuidSchema.optional(),
    /** The user's local date. Defaults to today in their stored timezone. */
    date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const CompassSchema = z.object({
    date:      z.string(),
    headline:  z.string(),
    dos:       z.array(z.string()),
    donts:     z.array(z.string()),
    /** The deterministic facts behind the advice, so it is inspectable. */
    basis: z.object({
        tithi:          z.string(),
        nakshatra:      z.string(),
        yoga:           z.string(),
        karana:         z.string(),
        vara:           z.string(),
        moonSign:       z.string(),
        currentDasha:   z.array(z.string()),
        notableTransits: z.array(z.string()),
    }),
    cachedAt:  z.string(),
});

export type Compass = z.infer<typeof CompassSchema>;
