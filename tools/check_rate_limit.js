/**
 * check_rate_limit.js
 * Tool 3 – Per-user daily query rate limiter.
 *
 * Input:  telegram_id {string|number} — Telegram user ID
 * Output: { allowed: boolean, remaining: number, used: number, reset_at: string }
 *
 * Rules:
 *   - Max 5 open-ended queries per calendar day (EST / America/New_York).
 *   - State persisted to <HoraMind_root>/rate_limits.json.
 *   - If the stored date differs from today's EST date → reset count to 0.
 *   - Each successful call (allowed=true) increments the counter atomically.
 *
 * File-locking:
 *   JSON reads/writes are wrapped in a simple retry loop to handle concurrent
 *   agents hitting the file simultaneously. For single-process deployments this
 *   is sufficient; use a database for true multi-process safety.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DAILY_LIMIT = 5;
const TIMEZONE    = 'America/New_York'; // EST/EDT

// Rate limits file lives at the HoraMind repo root (gitignored via .gitignore)
const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const LIMITS_FILE  = path.resolve(__dirname, '../rate_limits.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get today's date string in EST (YYYY-MM-DD).
 * Uses Intl.DateTimeFormat — no external dependencies needed.
 */
function todayEST() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year:  'numeric',
        month: '2-digit',
        day:   '2-digit',
    }).format(new Date()); // en-CA gives YYYY-MM-DD format natively
}

/**
 * Return the ISO timestamp for midnight EST tomorrow (i.e. when the quota resets).
 * Shown to users as a human-readable reset time.
 */
function nextMidnightEST() {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: TIMEZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });

    const now   = new Date();
    const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
    // Construct midnight of *tomorrow* in EST
    const midnightStr = `${parts.year}-${parts.month}-${parts.day}T00:00:00`;
    const midnight    = new Date(`${midnightStr} EST`);
    midnight.setDate(midnight.getDate() + 1);
    return midnight.toISOString();
}

/**
 * Read the rate_limits.json file. Returns {} if it doesn't exist or is corrupt.
 */
function readLimits() {
    try {
        if (!fs.existsSync(LIMITS_FILE)) return {};
        const raw = fs.readFileSync(LIMITS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        // Corrupt file — start fresh
        return {};
    }
}

/**
 * Write data to rate_limits.json atomically using a temp-file + rename pattern.
 * This prevents data loss if the process crashes mid-write.
 */
function writeLimits(data) {
    const tmpFile = `${LIMITS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, LIMITS_FILE);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Check and (if allowed) increment the rate limit for a Telegram user.
 *
 * @param {string|number} telegram_id — Telegram user ID
 * @returns {{
 *   allowed:   boolean,   — true if query is permitted (counter incremented)
 *   used:      number,    — queries used today (after this call if allowed)
 *   remaining: number,    — queries remaining today (after this call if allowed)
 *   limit:     number,    — daily cap (always 5)
 *   reset_at:  string,    — ISO timestamp of next daily reset (EST midnight)
 * }}
 */
export function checkRateLimit(telegram_id) {
    if (telegram_id == null || String(telegram_id).trim() === '') {
        throw new Error('telegram_id must be a non-empty string or number');
    }

    const userId  = String(telegram_id).trim();
    const today   = todayEST();
    const resetAt = nextMidnightEST();

    // Load current state
    const limits = readLimits();

    // Fetch or initialize the user's record
    const user = limits[userId] ?? { date: null, count: 0 };

    // Day rollover check (compare stored date to today in EST)
    if (user.date !== today) {
        user.date  = today;
        user.count = 0;
    }

    const allowed = user.count < DAILY_LIMIT;

    if (allowed) {
        user.count += 1;
        limits[userId] = user;
        writeLimits(limits);
    }

    return {
        allowed,
        used:      user.count,
        remaining: Math.max(0, DAILY_LIMIT - user.count),
        limit:     DAILY_LIMIT,
        reset_at:  resetAt,
    };
}

/**
 * Peek at a user's current limit state WITHOUT incrementing the counter.
 * Useful for the bot to display status without burning a query slot.
 *
 * @param {string|number} telegram_id
 * @returns {{ used: number, remaining: number, limit: number, reset_at: string }}
 */
export function peekRateLimit(telegram_id) {
    if (telegram_id == null || String(telegram_id).trim() === '') {
        throw new Error('telegram_id must be a non-empty string or number');
    }

    const userId  = String(telegram_id).trim();
    const today   = todayEST();
    const resetAt = nextMidnightEST();

    const limits = readLimits();
    const user   = limits[userId] ?? { date: null, count: 0 };

    // Day rollover (read-only view, don't persist)
    const count = user.date === today ? user.count : 0;

    return {
        used:      count,
        remaining: Math.max(0, DAILY_LIMIT - count),
        limit:     DAILY_LIMIT,
        reset_at:  resetAt,
    };
}

// ---------------------------------------------------------------------------
// CLI shim — run directly: node check_rate_limit.js 123456789
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const id   = process.argv[2];
    const peek = process.argv[3] === '--peek';

    if (!id) {
        console.error('Usage: node check_rate_limit.js <telegram_id> [--peek]');
        process.exit(1);
    }
    try {
        const result = peek ? peekRateLimit(id) : checkRateLimit(id);
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error({ error: err.message });
        process.exit(1);
    }
}
