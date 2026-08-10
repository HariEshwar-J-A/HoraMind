import type { Sql } from '../db/client.js';

/**
 * Session persistence — one row per signed-in device.
 *
 * This is what "log out of this device" and "log out everywhere" act on.
 * Refresh tokens are stored only as SHA-256 digests, so a database leak does
 * not hand an attacker live sessions.
 */

export interface SessionRow {
    id: string;
    userId: string;
    deviceLabel: string | null;
    platform: string | null;
    appVersion: string | null;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
}

export async function createSession(
    sql: Sql,
    input: {
        userId: string;
        refreshTokenHash: Buffer;
        deviceLabel: string;
        platform: string;
        appVersion: string | null;
        ipHash: Buffer | null;
        expiresAt: Date;
    },
): Promise<SessionRow> {
    const [row] = await sql<SessionRow[]>`
        INSERT INTO sessions (user_id, refresh_token_hash, device_label, platform,
                              app_version, ip_hash, expires_at)
        VALUES (${input.userId}, ${input.refreshTokenHash}, ${input.deviceLabel},
                ${input.platform}, ${input.appVersion}, ${input.ipHash}, ${input.expiresAt})
        RETURNING id, user_id, device_label, platform, app_version,
                  created_at, last_seen_at, expires_at, revoked_at`;
    if (!row) throw new Error('Session insert returned no row');
    return row;
}

/** Look up a live session by the digest of the refresh token presented. */
export async function findLiveSessionByToken(sql: Sql, tokenHash: Buffer): Promise<SessionRow | null> {
    const [row] = await sql<SessionRow[]>`
        SELECT id, user_id, device_label, platform, app_version,
               created_at, last_seen_at, expires_at, revoked_at
          FROM sessions
         WHERE refresh_token_hash = ${tokenHash}
           AND revoked_at IS NULL
           AND expires_at > now()`;
    return row ?? null;
}

/**
 * Find a session whose *previous* refresh token matches.
 *
 * A hit means an already-rotated token was replayed. Since rotation happens on
 * every refresh, the legitimate client cannot still hold the old value — so the
 * most likely explanation is theft, and the caller revokes the session rather
 * than issuing new tokens to whoever asked.
 */
export async function findSessionByPreviousToken(sql: Sql, tokenHash: Buffer): Promise<SessionRow | null> {
    const [row] = await sql<SessionRow[]>`
        SELECT id, user_id, device_label, platform, app_version,
               created_at, last_seen_at, expires_at, revoked_at
          FROM sessions
         WHERE previous_token_hash = ${tokenHash}`;
    return row ?? null;
}

/**
 * Rotate a session's refresh token.
 *
 * Conditional on the old digest still being current, so two concurrent
 * refreshes cannot both succeed: the second updates zero rows and is rejected.
 */
export async function rotateSessionToken(
    sql: Sql,
    sessionId: string,
    oldHash: Buffer,
    newHash: Buffer,
    expiresAt: Date,
): Promise<boolean> {
    const rows = await sql`
        UPDATE sessions
           SET refresh_token_hash  = ${newHash},
               previous_token_hash = ${oldHash},
               last_seen_at        = now(),
               expires_at          = ${expiresAt}
         WHERE id = ${sessionId}
           AND refresh_token_hash = ${oldHash}
           AND revoked_at IS NULL
        RETURNING id`;
    return rows.length > 0;
}

export async function touchSession(sql: Sql, sessionId: string): Promise<void> {
    await sql`UPDATE sessions SET last_seen_at = now() WHERE id = ${sessionId}`;
}

export async function revokeSession(sql: Sql, userId: string, sessionId: string): Promise<boolean> {
    const rows = await sql`
        UPDATE sessions SET revoked_at = now()
         WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL
        RETURNING id`;
    return rows.length > 0;
}

/** Revoke every session, optionally sparing the caller's own. */
export async function revokeAllSessions(
    sql: Sql,
    userId: string,
    exceptSessionId?: string,
): Promise<number> {
    const rows = exceptSessionId
        ? await sql`UPDATE sessions SET revoked_at = now()
                     WHERE user_id = ${userId} AND revoked_at IS NULL
                       AND id <> ${exceptSessionId} RETURNING id`
        : await sql`UPDATE sessions SET revoked_at = now()
                     WHERE user_id = ${userId} AND revoked_at IS NULL RETURNING id`;
    return rows.length;
}

export async function listSessions(sql: Sql, userId: string): Promise<SessionRow[]> {
    return sql<SessionRow[]>`
        SELECT id, user_id, device_label, platform, app_version,
               created_at, last_seen_at, expires_at, revoked_at
          FROM sessions
         WHERE user_id = ${userId} AND revoked_at IS NULL AND expires_at > now()
         ORDER BY last_seen_at DESC`;
}

/**
 * Is this session still live?
 *
 * Checked on every authenticated request. It is what makes device revocation
 * take effect immediately instead of at the end of the access token's life —
 * the cost of a primary-key lookup in exchange for logout that actually logs
 * out.
 */
export async function isSessionLive(sql: Sql, sessionId: string): Promise<boolean> {
    const [row] = await sql<{ ok: boolean }[]>`
        SELECT true AS ok FROM sessions
         WHERE id = ${sessionId} AND revoked_at IS NULL AND expires_at > now()`;
    return Boolean(row);
}
