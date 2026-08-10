import {
    REFRESH_TOKEN_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS,
    type DeviceInfo, type TokenPair, type PublicUser, type AuthProvider,
} from '@horamind/shared';

import type { Sql } from '../db/client.js';
import type { Env } from '../config/env.js';
import { signAccessToken } from '../lib/jwt.js';
import {
    hashPassword, verifyPassword, fakeVerifyDelay,
    generateOpaqueToken, hashToken, hashIp,
} from '../lib/crypto.js';
import { verifyIdToken } from '../lib/oidc.js';
import { conflict, invalidCredentials, unauthorized, badRequest } from '../lib/errors.js';
import * as users from '../repos/users.js';
import * as sessions from '../repos/sessions.js';

/**
 * Authentication.
 *
 * The design point that everything else follows from: a **short-lived access
 * JWT** plus a **rotating refresh token backed by a database row**. The product
 * asked for "no sessions", but per-device logout is only possible if the server
 * knows which devices exist and can revoke one — a bare stateless JWT cannot be
 * withdrawn, so logout would be cosmetic and a stolen token would stay valid
 * until it expired. This gives the requested experience with real revocation.
 */

function refreshExpiry(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

async function issueTokens(
    env: Env,
    user: users.UserRow,
    sessionId: string,
    refreshToken: string,
): Promise<TokenPair> {
    const accessToken = await signAccessToken(env, {
        userId: user.id,
        publicId: user.publicId,
        tier: user.tier,
        sessionId,
    });
    return {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        tokenType: 'Bearer',
    };
}

async function startSession(
    sql: Sql,
    env: Env,
    user: users.UserRow,
    device: DeviceInfo,
    ip: string | null,
): Promise<TokenPair> {
    const refreshToken = generateOpaqueToken();
    const session = await sessions.createSession(sql, {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        deviceLabel: device.label,
        platform: device.platform,
        appVersion: device.appVersion ?? null,
        ipHash: ip ? hashIp(ip, env.JWT_SECRET) : null,
        expiresAt: refreshExpiry(),
    });
    return issueTokens(env, user, session.id, refreshToken);
}

export async function toPublicUser(sql: Sql, user: users.UserRow): Promise<PublicUser> {
    return {
        publicId: user.publicId,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        displayName: user.displayName,
        tier: user.tier,
        timezone: user.timezone,
        createdAt: user.createdAt.toISOString(),
        linkedProviders: await users.listLinkedProviders(sql, user.id),
    };
}

export async function register(
    sql: Sql,
    env: Env,
    input: { email: string; password: string; displayName?: string; timezone: string },
    device: DeviceInfo,
    ip: string | null,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const existing = await users.findUserByEmail(sql, input.email);
    if (existing) {
        // Registration necessarily reveals whether an address is taken — there
        // is no way to create an account at an address that already has one.
        // Login and password reset, which have no such constraint, stay silent.
        throw conflict('An account already exists for this email', 'EMAIL_IN_USE');
    }

    const user = await users.createUserWithIdentity(sql, {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName ?? null,
        timezone: input.timezone,
        emailVerified: false,
        provider: 'password',
        // A password identity has no external account id; the user's own id
        // keeps the (provider, provider_account_id) uniqueness meaningful.
        providerAccountId: input.email,
    });

    return {
        user: await toPublicUser(sql, user),
        tokens: await startSession(sql, env, user, device, ip),
    };
}

export async function login(
    sql: Sql,
    env: Env,
    input: { email: string; password: string },
    device: DeviceInfo,
    ip: string | null,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await users.findUserByEmail(sql, input.email);

    // Spend the same time whether or not the account exists. Returning early
    // here would make "no such user" measurably faster than a wrong password,
    // which is a reliable account-enumeration oracle.
    if (!user || !user.passwordHash) {
        await fakeVerifyDelay();
        throw invalidCredentials();
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw invalidCredentials();
    }

    return {
        user: await toPublicUser(sql, user),
        tokens: await startSession(sql, env, user, device, ip),
    };
}

/**
 * Sign in with Google or Apple.
 *
 * Account linking is by verified email: if an address already has an account
 * and the provider says it verified that address, the identity is attached to
 * the existing user rather than creating a second one. The `emailVerified`
 * check is load-bearing — linking on an unverified address would let anyone
 * who can assert an email take over the account that owns it.
 */
export async function oauthLogin(
    sql: Sql,
    env: Env,
    input: { provider: 'google' | 'apple'; idToken: string; fullName?: string },
    device: DeviceInfo,
    ip: string | null,
): Promise<{ user: PublicUser; tokens: TokenPair; created: boolean }> {
    const identity = await verifyIdToken(env, input.provider, input.idToken);

    const linked = await users.findUserByProviderAccount(sql, input.provider, identity.subject);
    if (linked) {
        await users.touchIdentityUse(sql, input.provider, identity.subject);
        return {
            user: await toPublicUser(sql, linked),
            tokens: await startSession(sql, env, linked, device, ip),
            created: false,
        };
    }

    if (!identity.email) {
        throw badRequest(
            'The provider did not supply an email address, which this account requires',
        );
    }

    const byEmail = await users.findUserByEmail(sql, identity.email);
    if (byEmail) {
        if (!identity.emailVerified) {
            throw conflict(
                'An account exists for this email. Sign in with your password to link this provider.',
                'EMAIL_NOT_VERIFIED_AT_PROVIDER',
            );
        }
        await users.linkIdentity(sql, byEmail.id, input.provider, identity.subject, identity.email);
        return {
            user: await toPublicUser(sql, byEmail),
            tokens: await startSession(sql, env, byEmail, device, ip),
            created: false,
        };
    }

    const created = await users.createUserWithIdentity(sql, {
        email: identity.email,
        // No password: these users authenticate only through the provider until
        // they deliberately set one.
        passwordHash: null,
        // Apple returns the name exactly once, out of band, so `fullName` from
        // the client is the only chance to capture it.
        displayName: identity.name ?? input.fullName ?? null,
        timezone: 'UTC',
        emailVerified: identity.emailVerified,
        provider: input.provider,
        providerAccountId: identity.subject,
    });

    return {
        user: await toPublicUser(sql, created),
        tokens: await startSession(sql, env, created, device, ip),
        created: true,
    };
}

/**
 * Exchange a refresh token for a new pair.
 *
 * Rotation with reuse detection. Presenting a token that was already rotated
 * away means someone is holding a copy the legitimate client no longer has, so
 * the entire session is revoked rather than refreshed — the honest client will
 * be forced to sign in again, which is the correct outcome when its token has
 * demonstrably leaked.
 */
export async function refresh(
    sql: Sql,
    env: Env,
    refreshToken: string,
): Promise<TokenPair> {
    const presented = hashToken(refreshToken);

    const live = await sessions.findLiveSessionByToken(sql, presented);
    if (!live) {
        const replayed = await sessions.findSessionByPreviousToken(sql, presented);
        if (replayed) {
            await sessions.revokeAllSessions(sql, replayed.userId);
            throw unauthorized('Session revoked: this refresh token was already used');
        }
        throw unauthorized('Refresh token is invalid or expired');
    }

    const user = await users.findUserById(sql, live.userId);
    if (!user) throw unauthorized('Account no longer exists');

    const nextToken = generateOpaqueToken();
    const rotated = await sessions.rotateSessionToken(
        sql, live.id, presented, hashToken(nextToken), refreshExpiry(),
    );

    // Lost a race with a concurrent refresh on the same token. Rather than
    // issue a second valid pair, refuse — the winner already has one.
    if (!rotated) throw unauthorized('Refresh token is no longer current');

    return issueTokens(env, user, live.id, nextToken);
}

export async function logout(sql: Sql, userId: string, sessionId: string): Promise<void> {
    await sessions.revokeSession(sql, userId, sessionId);
}

export async function logoutEverywhere(
    sql: Sql,
    userId: string,
    exceptSessionId?: string,
): Promise<number> {
    return sessions.revokeAllSessions(sql, userId, exceptSessionId);
}

/**
 * Delete an account.
 *
 * Re-authentication is required: a stolen access token should not be able to
 * destroy an account. Users with no password confirm with a fresh provider ID
 * token instead.
 *
 * In-app deletion is also mandatory under App Store Guideline 5.1.1(v), and
 * Google Play additionally requires a web-reachable route to the same thing.
 */
export async function deleteAccount(
    sql: Sql,
    env: Env,
    userId: string,
    proof: { password?: string; idToken?: string },
): Promise<void> {
    const user = await users.findUserById(sql, userId);
    if (!user) throw unauthorized('Account no longer exists');

    if (user.passwordHash) {
        if (!proof.password || !(await verifyPassword(user.passwordHash, proof.password))) {
            throw invalidCredentials();
        }
    } else {
        if (!proof.idToken) {
            throw badRequest('Confirm deletion by signing in with your provider again');
        }
        const linked = await users.listLinkedProviders(sql, userId);
        const provider = linked.find((p): p is Extract<AuthProvider, 'google' | 'apple'> =>
            p === 'google' || p === 'apple');
        if (!provider) throw badRequest('No provider available to confirm deletion');

        const identity = await verifyIdToken(env, provider, proof.idToken);
        const owner = await users.findUserByProviderAccount(sql, provider, identity.subject);
        if (!owner || owner.id !== userId) throw invalidCredentials();
    }

    await users.softDeleteUser(sql, userId);
}
