/**
 * user_manager.js
 * Tool: User profile management + access isolation enforcement.
 *
 * SECURITY CONTRACT:
 *   A regular user can ONLY access their own data.
 *   An admin (configured in settings.json) can access ANY user's data.
 *   This rule is enforced at the tool level — not just in the AI instructions.
 *
 * Actions:
 *   "session_start"  — identify user, return onboarding status + blueprint path
 *   "save_birth"     — store birth details for a user (self or admin for any user)
 *   "get_profile"    — retrieve stored birth data (self or admin for any user)
 *   "is_onboarded"   — check if master_karmic_blueprint.md exists
 *   "list_users"     — admin only: list all user IDs with onboarding status
 *
 * Input:
 *   {
 *     "action":           string   — one of the actions above
 *     "requesting_id":    string   — Telegram ID of the user making the request
 *     "target_id"?:       string   — Telegram ID of the target user (defaults to requesting_id)
 *     "birth_data"?:      object   — { date, time, lat, lon, timezone, ayanamsa, city, name? }
 *   }
 *
 * Returns: JSON object with result or error.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const USERS_DIR  = path.join(ROOT, 'users');
const SETTINGS   = path.join(ROOT, 'settings.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSettings() {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    } catch {
        return { admin: { telegram_user_ids: [] }, defaults: { rate_limit_per_day: 5 } };
    }
}

function isAdmin(telegram_id) {
    const settings = loadSettings();
    return (settings?.admin?.telegram_user_ids ?? []).includes(String(telegram_id));
}

/**
 * Enforce access control.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
function checkAccess(requesting_id, target_id) {
    const rid = String(requesting_id);
    const tid = String(target_id);
    if (rid === tid) return { allowed: true };
    if (isAdmin(rid)) return { allowed: true, admin_override: true };
    return {
        allowed: false,
        reason: `Access denied. You can only access your own chart (ID: ${rid}). You attempted to access user ${tid}.`,
    };
}

function userDir(telegram_id) {
    return path.join(USERS_DIR, String(telegram_id));
}

function ensureUserDir(telegram_id) {
    const dir = userDir(telegram_id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function profilePath(telegram_id) {
    return path.join(userDir(telegram_id), 'chart_data.json');
}

function blueprintPath(telegram_id) {
    return path.join(userDir(telegram_id), 'master_karmic_blueprint.md');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function sessionStart(requesting_id) {
    const tid          = String(requesting_id);
    const onboarded    = fs.existsSync(blueprintPath(tid));
    const hasProfile   = fs.existsSync(profilePath(tid));
    const admin        = isAdmin(tid);

    return {
        action:       'session_start',
        telegram_id:  tid,
        is_admin:     admin,
        is_onboarded: onboarded,
        has_profile:  hasProfile,
        blueprint_path: onboarded ? `users/${tid}/master_karmic_blueprint.md` : null,
        message: onboarded
            ? `Returning user ${tid}. Blueprint ready at users/${tid}/master_karmic_blueprint.md.`
            : `New user ${tid}. No blueprint found — begin onboarding.`,
    };
}

function saveBirth(requesting_id, target_id, birth_data) {
    const access = checkAccess(requesting_id, target_id);
    if (!access.allowed) return { error: access.reason };

    if (!birth_data || !birth_data.date || !birth_data.time || birth_data.lat == null || birth_data.lon == null) {
        return { error: 'birth_data must include: date, time, lat, lon' };
    }

    const dir = ensureUserDir(target_id);
    const record = {
        telegram_id:  String(target_id),
        saved_by:     String(requesting_id),
        saved_at:     new Date().toISOString(),
        birth: {
            date:     birth_data.date,
            time:     birth_data.time,
            lat:      birth_data.lat,
            lon:      birth_data.lon,
            timezone: birth_data.timezone ?? null,
            ayanamsa: birth_data.ayanamsa ?? 'LAHIRI',
            city:     birth_data.city ?? null,
            name:     birth_data.name ?? null,
        },
    };

    fs.writeFileSync(profilePath(target_id), JSON.stringify(record, null, 2), 'utf8');

    return {
        action:      'save_birth',
        telegram_id: String(target_id),
        saved:       true,
        profile_path: `users/${target_id}/chart_data.json`,
    };
}

function getProfile(requesting_id, target_id) {
    const access = checkAccess(requesting_id, target_id);
    if (!access.allowed) return { error: access.reason };

    const p = profilePath(target_id);
    if (!fs.existsSync(p)) {
        return {
            action:      'get_profile',
            telegram_id: String(target_id),
            found:       false,
            message:     `No birth profile found for user ${target_id}. Onboarding required.`,
        };
    }

    const record = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
        action:      'get_profile',
        telegram_id: String(target_id),
        found:       true,
        birth:       record.birth,
    };
}

function isOnboarded(requesting_id, target_id) {
    const access = checkAccess(requesting_id, target_id);
    if (!access.allowed) return { error: access.reason };

    const onboarded = fs.existsSync(blueprintPath(target_id));
    return {
        action:       'is_onboarded',
        telegram_id:  String(target_id),
        is_onboarded: onboarded,
    };
}

function listUsers(requesting_id) {
    if (!isAdmin(requesting_id)) {
        return { error: 'Access denied. Only admins can list all users.' };
    }

    if (!fs.existsSync(USERS_DIR)) return { action: 'list_users', users: [] };

    const entries = fs.readdirSync(USERS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => {
            const tid = e.name;
            return {
                telegram_id:  tid,
                is_onboarded: fs.existsSync(blueprintPath(tid)),
                has_profile:  fs.existsSync(profilePath(tid)),
            };
        });

    return { action: 'list_users', users: entries };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function manageUser(input) {
    const {
        action,
        requesting_id,
        target_id = requesting_id,
        birth_data,
    } = input;

    if (!requesting_id) {
        return { error: 'requesting_id is required — pass the current Telegram user ID.' };
    }

    switch (action) {
        case 'session_start': return sessionStart(requesting_id);
        case 'save_birth':    return saveBirth(requesting_id, target_id, birth_data);
        case 'get_profile':   return getProfile(requesting_id, target_id);
        case 'is_onboarded':  return isOnboarded(requesting_id, target_id);
        case 'list_users':    return listUsers(requesting_id);
        default:
            return { error: `Unknown action "${action}". Valid: session_start, save_birth, get_profile, is_onboarded, list_users` };
    }
}

// ---------------------------------------------------------------------------
// CLI shim — node tools/user_manager.js '{"action":"session_start","requesting_id":"123"}'
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const raw = process.argv[2];
    if (!raw) {
        console.error('Usage: node tools/user_manager.js \'{"action":"session_start","requesting_id":"<telegram_id>"}\'');
        process.exit(1);
    }
    try {
        const result = manageUser(JSON.parse(raw));
        console.log(JSON.stringify(result, null, 2));
    } catch (err) {
        console.error({ error: err.message });
        process.exit(1);
    }
}
