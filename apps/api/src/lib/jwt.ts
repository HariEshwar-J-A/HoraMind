import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS, type Tier } from '@horamind/shared';
import type { Env } from '../config/env.js';
import { unauthorized } from './errors.js';

/**
 * Access tokens.
 *
 * Symmetric HS256 rather than RS256: there is one issuer and one verifier, both
 * this process, so asymmetric keys would add key distribution without adding
 * security. If the API is ever split so that another service verifies tokens it
 * does not issue, this should move to RS256 or EdDSA.
 *
 * The token carries `sid`, the session it was minted from. That is what makes
 * "log out of this device" bite within one access-token lifetime instead of
 * waiting for a 60-day refresh to expire.
 */

export interface AccessTokenClaims extends JWTPayload {
    sub: string;
    pid: string;
    tier: Tier;
    sid: string;
}

let cachedKey: Uint8Array | null = null;

function key(env: Env): Uint8Array {
    if (!cachedKey) cachedKey = new TextEncoder().encode(env.JWT_SECRET);
    return cachedKey;
}

export async function signAccessToken(
    env: Env,
    claims: { userId: string; publicId: string; tier: Tier; sessionId: string },
): Promise<string> {
    return new SignJWT({ pid: claims.publicId, tier: claims.tier, sid: claims.sessionId })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(claims.userId)
        .setIssuedAt()
        .setIssuer(env.JWT_ISSUER)
        .setAudience(env.JWT_AUDIENCE)
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key(env));
}

/**
 * Verify and decode an access token.
 *
 * Issuer and audience are checked, not just the signature. A token signed with
 * the same secret but minted for a different audience — a staging environment
 * sharing a secret, say — must not be accepted here.
 */
export async function verifyAccessToken(env: Env, token: string): Promise<AccessTokenClaims> {
    try {
        const { payload } = await jwtVerify(token, key(env), {
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
            algorithms: ['HS256'],
        });

        if (!payload.sub || typeof payload.sid !== 'string' || typeof payload.pid !== 'string') {
            throw unauthorized('Malformed token');
        }
        return payload as AccessTokenClaims;
    } catch (err) {
        if (err instanceof Error && err.name === 'JWTExpired') {
            throw unauthorized('Access token expired');
        }
        throw unauthorized('Invalid access token');
    }
}

/** Test helper: drop the memoised key so a different secret can be used. */
export function resetJwtKey(): void {
    cachedKey = null;
}
