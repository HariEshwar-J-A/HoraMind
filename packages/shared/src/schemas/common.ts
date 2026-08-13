import { z } from 'zod';

/**
 * Primitives reused across request and response schemas.
 *
 * Shared between the API and the mobile client so that a validation rule is
 * written once. The client can then reject bad input before a round trip, using
 * exactly the rule the server will apply.
 */

/** Internal identifier. Never shown to users. */
export const UuidSchema = z.string().uuid();

/** The 8-hex handle a user sees and can quote to support. */
export const PublicIdSchema = z.string().regex(/^[0-9A-F]{8}$/, 'Must be 8 uppercase hex characters');

export const EmailSchema = z.string().email().max(254).transform(s => s.trim().toLowerCase());

/**
 * Password policy: length over composition rules.
 *
 * NIST SP 800-63B advises against mandatory character-class rules — they push
 * users toward predictable substitutions — and in favour of a long minimum plus
 * a breached-password check. The 72-byte ceiling is bcrypt's; argon2id has no
 * such limit, but capping input keeps the door closed if the hash ever changes.
 */
export const PasswordSchema = z.string().min(10, 'At least 10 characters').max(200);

export const IanaTimezoneSchema = z.string().min(1).max(64).refine(
    tz => {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
        } catch {
            return false;
        }
    },
    { message: 'Not a recognised IANA timezone, e.g. "Asia/Kolkata"' },
);

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const IsoTimeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, 'Must be HH:MM:SS');

export const LatitudeSchema  = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

/** Cursor pagination. Offset pagination skips or repeats rows when data shifts. */
export const PaginationSchema = z.object({
    limit:  z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
});

/** Every error response has this shape, so a client can handle them uniformly. */
export const ApiErrorSchema = z.object({
    error: z.object({
        code:      z.string(),
        message:   z.string(),
        details:   z.unknown().optional(),
        requestId: z.string().optional(),
    }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
