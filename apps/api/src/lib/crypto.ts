import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing and opaque token handling.
 *
 * Two different problems that are easy to conflate:
 *
 *   - **Passwords** are low-entropy and chosen by humans, so they need a slow,
 *     memory-hard hash. argon2id is the current recommendation (OWASP, and the
 *     Password Hashing Competition winner); it resists both GPU and
 *     side-channel attack, which argon2i and argon2d each only half solve.
 *   - **Refresh tokens** are 256 bits from a CSPRNG. They have nothing to
 *     brute-force, so a slow hash would burn CPU on every refresh for no gain.
 *     SHA-256 is correct here, and fast is a feature.
 */

/**
 * OWASP's minimum configuration for argon2id: 19 MiB of memory, 2 iterations,
 * 1 degree of parallelism. Memory cost is the parameter that actually hurts an
 * attacker with GPUs, which is why it is set well above the library default.
 */
/**
 * `Algorithm.Argon2id`. The library exports that as an ambient const enum,
 * which `isolatedModules` cannot inline, so the value is written out. It is
 * also the library's default — stated explicitly because which argon2 variant
 * is in use is a security property, not an implementation detail.
 */
const ARGON2ID = 2;

const ARGON_OPTIONS = {
    algorithm: ARGON2ID,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
    return argonHash(plain, ARGON_OPTIONS);
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row
 * should read as "wrong password" to the caller, not as a 500 that tells an
 * attacker they found something interesting.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
        return await argonVerify(hash, plain, ARGON_OPTIONS);
    } catch {
        return false;
    }
}

/**
 * Burn roughly the cost of a real verification.
 *
 * Called when the email does not exist. Without it, "no such user" returns in
 * microseconds while a real user's wrong password takes ~50 ms, and that gap is
 * a reliable account-enumeration oracle.
 */
export async function fakeVerifyDelay(): Promise<void> {
    await argonVerify(
        // A fixed argon2id hash of a value nobody will ever submit.
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNlYmF0dGVyeQ',
        'never-matches',
        ARGON_OPTIONS,
    ).catch(() => false);
}

/** 256 bits from the OS CSPRNG, URL-safe so it survives headers and query strings. */
export function generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
}

/** Storage form of an opaque token. The token itself is never persisted. */
export function hashToken(token: string): Buffer {
    return createHash('sha256').update(token).digest();
}

/**
 * Constant-time comparison of two digests.
 *
 * `Buffer.equals` short-circuits on the first differing byte, which leaks how
 * much of a guess was correct.
 */
export function digestsEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Hash a client IP before storing it.
 *
 * The device list needs to let a user recognise a session, not to build a
 * location history. A salted hash supports "same network as before" without
 * retaining an identifier that is personal data in its own right.
 */
export function hashIp(ip: string, salt: string): Buffer {
    return createHash('sha256').update(`${salt}:${ip}`).digest();
}
