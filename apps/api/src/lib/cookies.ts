import type { FastifyReply, FastifyRequest } from 'fastify';
import { REFRESH_TOKEN_TTL_SECONDS } from '@horamind/shared';
import type { Env } from '../config/env.js';

/**
 * Refresh-token cookie.
 *
 * A browser client cannot hold a refresh token safely in JavaScript-reachable
 * storage: anything `localStorage` can read, injected script can read too. An
 * httpOnly cookie is unreadable from JavaScript by construction, which makes it
 * the one place a long-lived credential belongs on the web.
 *
 * This is why the API is served under `/api` on the same origin as the client
 * rather than on an `api.` subdomain — `SameSite=Strict` only protects a cookie
 * the site actually owns.
 *
 * Native clients ignore all of this and send the token in the request body,
 * since they have secure storage of their own and no cookie jar.
 */

export const REFRESH_COOKIE = 'hm_rt';

/** Scoped to the refresh and logout routes; no other request needs to carry it. */
const COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(reply: FastifyReply, env: Env, token: string): void {
    void reply.setCookie(REFRESH_COOKIE, token, {
        httpOnly: true,
        // Strict, not Lax: nothing about this app is reached by following a
        // link from elsewhere, so there is no flow that Strict would break.
        sameSite: 'strict',
        // Secure everywhere except local http development, where the browser
        // would otherwise refuse to store it at all.
        secure: env.NODE_ENV === 'production' || env.PUBLIC_BASE_URL.startsWith('https'),
        path: COOKIE_PATH,
        maxAge: REFRESH_TOKEN_TTL_SECONDS,
        signed: false,
    });
}

export function clearRefreshCookie(reply: FastifyReply, env: Env): void {
    void reply.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        sameSite: 'strict',
        secure: env.NODE_ENV === 'production' || env.PUBLIC_BASE_URL.startsWith('https'),
        path: COOKIE_PATH,
    });
}

/**
 * Read the refresh token from wherever this client keeps it.
 *
 * Body first, so a native client is never affected by a stale cookie that some
 * proxy or shared browser session happened to attach.
 */
export function readRefreshToken(req: FastifyRequest, bodyToken?: string): string | null {
    if (bodyToken && bodyToken.length >= 16) return bodyToken;
    const cookie = req.cookies?.[REFRESH_COOKIE];
    return cookie && cookie.length >= 16 ? cookie : null;
}
