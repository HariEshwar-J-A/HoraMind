/**
 * Application errors.
 *
 * Every failure a client can meaningfully act on gets a stable `code` string.
 * Clients switch on codes, not on message text — messages are for humans and
 * are free to be reworded or translated without breaking anything.
 */

export class AppError extends Error {
    constructor(
        readonly statusCode: number,
        readonly code: string,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export const badRequest = (msg: string, details?: unknown) =>
    new AppError(400, 'BAD_REQUEST', msg, details);

export const unauthorized = (msg = 'Authentication required') =>
    new AppError(401, 'UNAUTHORIZED', msg);

/** Wrong credentials. Deliberately identical whether or not the email exists. */
export const invalidCredentials = () =>
    new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const forbidden = (msg = 'Not permitted') =>
    new AppError(403, 'FORBIDDEN', msg);

export const notFound = (what = 'Resource') =>
    new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (msg: string, code = 'CONFLICT') =>
    new AppError(409, code, msg);

/**
 * A product limit was reached — 30 memories, 5 interests, the daily chat quota.
 * Distinct from 429 rate limiting: retrying later does not help, the user has
 * to delete something or upgrade.
 */
export const limitReached = (msg: string, details?: unknown) =>
    new AppError(409, 'LIMIT_REACHED', msg, details);

export const quotaExceeded = (msg: string, details?: unknown) =>
    new AppError(429, 'QUOTA_EXCEEDED', msg, details);

export const upstreamFailure = (msg: string, details?: unknown) =>
    new AppError(502, 'UPSTREAM_FAILURE', msg, details);

export const serviceUnavailable = (msg: string) =>
    new AppError(503, 'SERVICE_UNAVAILABLE', msg);
