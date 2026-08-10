import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { isSessionLive } from '../repos/sessions.js';
import { loadEnv } from '../config/env.js';

/**
 * Bearer authentication.
 *
 * Registers `app.authenticate`, used as a route `preHandler`. Authentication is
 * opt-in per route rather than global-with-exceptions: a route that forgets to
 * opt out of a global guard fails loudly in testing, but a route that forgets
 * to opt *in* to one silently serves unauthenticated traffic. Making it
 * explicit means the security posture of a route is visible in its definition.
 *
 * Two checks run on every request:
 *
 *   1. The JWT verifies (signature, issuer, audience, expiry).
 *   2. The session named by `sid` is still live.
 *
 * The second is what makes "log out of this device" take effect immediately
 * rather than whenever the current access token happens to expire. It costs a
 * primary-key lookup per request, which is the right trade for logout that
 * actually logs out.
 */

declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireVerifiedEmail: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

function bearerFrom(req: FastifyRequest): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
    return token;
}

export const authPlugin = fp(async (app: FastifyInstance) => {
    const env = loadEnv();

    app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
        const token = bearerFrom(req);
        if (!token) throw unauthorized('Missing bearer token');

        const claims = await verifyAccessToken(env, token);

        if (!(await isSessionLive(getDb(), claims.sid))) {
            throw unauthorized('Session has been revoked');
        }

        req.user = {
            id: claims.sub,
            publicId: claims.pid,
            tier: claims.tier,
            sessionId: claims.sid,
        };
    });

    /**
     * For routes that must not run on an unverified address — anything that
     * sends email, or that a stranger could use to spam someone else's inbox.
     */
    app.decorate('requireVerifiedEmail', async (req: FastifyRequest, reply: FastifyReply) => {
        await app.authenticate(req, reply);
        const [row] = await getDb()<{ verified: boolean }[]>`
            SELECT email_verified_at IS NOT NULL AS verified
              FROM users WHERE id = ${req.user!.id}`;
        if (!row?.verified) throw forbidden('Verify your email address to continue');
    });
});
