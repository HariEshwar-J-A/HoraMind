import 'fastify';
import type { Tier } from '@horamind/shared';

/**
 * The authenticated principal, attached by the auth plugin (Epic 2).
 *
 * Declared here rather than cast at each use so that a route which forgets to
 * register the auth hook fails to compile instead of reading `undefined` at
 * runtime.
 */
declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            /** Internal UUID. */
            id: string;
            /** The 8-hex handle shown to the user. */
            publicId: string;
            tier: Tier;
            /** The session this access token was minted from, for device revocation. */
            sessionId: string;
        };
    }
}
