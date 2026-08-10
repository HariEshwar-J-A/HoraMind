import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from '../config/env.js';
import { unauthorized, badRequest } from './errors.js';

/**
 * Google and Apple ID token verification.
 *
 * The client performs the interactive sign-in and hands us the resulting ID
 * token; the server verifies it. Three checks matter, and skipping any one of
 * them makes the whole thing decorative:
 *
 *   1. **Signature** against the provider's published JWKS. Without it, anyone
 *      can mint a token claiming to be anyone.
 *   2. **Issuer**, so a token from an unrelated provider is not accepted.
 *   3. **Audience**, so a token minted for a *different app* — including a
 *      malicious one the attacker controls — cannot be replayed here. This is
 *      the check most often forgotten, and on its own it makes the difference
 *      between authentication and a formality.
 *
 * `createRemoteJWKSet` caches keys and re-fetches on rotation, so this is one
 * network call per key rollover rather than per login.
 */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL, { cacheMaxAge: 3_600_000 });
const appleJwks  = createRemoteJWKSet(APPLE_JWKS_URL,  { cacheMaxAge: 3_600_000 });

export interface VerifiedIdentity {
    /** The provider's stable subject id. Not the email — emails change. */
    subject: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
}

/** Every client id we issue tokens for; a token must match one of them. */
function googleAudiences(env: Env): string[] {
    return [env.GOOGLE_CLIENT_ID_IOS, env.GOOGLE_CLIENT_ID_ANDROID, env.GOOGLE_CLIENT_ID_WEB]
        .filter((v): v is string => Boolean(v));
}

function appleAudiences(env: Env): string[] {
    return [env.APPLE_BUNDLE_ID, env.APPLE_SERVICE_ID]
        .filter((v): v is string => Boolean(v));
}

export async function verifyGoogleIdToken(env: Env, idToken: string): Promise<VerifiedIdentity> {
    const audience = googleAudiences(env);
    if (!audience.length) {
        // Refuse rather than verify without an audience check, which would
        // accept any Google token for any application in the world.
        throw badRequest('Google sign-in is not configured on this server');
    }

    try {
        const { payload } = await jwtVerify(idToken, googleJwks, {
            issuer: GOOGLE_ISSUERS,
            audience,
        });

        if (!payload.sub) throw unauthorized('Google token has no subject');

        return {
            subject: payload.sub,
            email: typeof payload.email === 'string' ? payload.email : null,
            // Google sets this false for unverified addresses; trusting it
            // blindly would let someone claim an email they do not control.
            emailVerified: payload.email_verified === true,
            name: typeof payload.name === 'string' ? payload.name : null,
        };
    } catch (err) {
        if (err instanceof Error && err.name === 'JWTExpired') {
            throw unauthorized('Google token has expired');
        }
        throw unauthorized('Google token could not be verified');
    }
}

export async function verifyAppleIdToken(env: Env, idToken: string): Promise<VerifiedIdentity> {
    const audience = appleAudiences(env);
    if (!audience.length) {
        throw badRequest('Sign in with Apple is not configured on this server');
    }

    try {
        const { payload } = await jwtVerify(idToken, appleJwks, {
            issuer: APPLE_ISSUER,
            audience,
        });

        if (!payload.sub) throw unauthorized('Apple token has no subject');

        return {
            subject: payload.sub,
            // With Private Relay this is a @privaterelay.appleid.com address.
            // It is a real, deliverable address and must be treated as one.
            email: typeof payload.email === 'string' ? payload.email : null,
            // Apple sends this as either a boolean or the string "true".
            emailVerified: payload.email_verified === true || payload.email_verified === 'true',
            // Apple never puts the name in the token. It is returned exactly
            // once, out of band, on first authorisation — the client has to
            // forward it or it is lost permanently.
            name: null,
        };
    } catch (err) {
        if (err instanceof Error && err.name === 'JWTExpired') {
            throw unauthorized('Apple token has expired');
        }
        throw unauthorized('Apple token could not be verified');
    }
}

export async function verifyIdToken(
    env: Env,
    provider: 'google' | 'apple',
    idToken: string,
): Promise<VerifiedIdentity> {
    return provider === 'google'
        ? verifyGoogleIdToken(env, idToken)
        : verifyAppleIdToken(env, idToken);
}
