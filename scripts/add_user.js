/**
 * add_user.js
 * Add or remove a Telegram user ID from the allowed_users whitelist.
 * Automatically syncs to openclaw.json.
 *
 * Usage:
 *   node scripts/add_user.js add 123456789
 *   node scripts/add_user.js remove 123456789
 *   node scripts/add_user.js list
 *   node scripts/add_user.js admin-add 123456789
 *   node scripts/add_user.js admin-remove 123456789
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SETTINGS   = path.join(ROOT, 'settings.json');
const OPENCLAW   = path.join(ROOT, 'openclaw.json');

function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 4), 'utf8'); }

function syncWhitelist(settings, openclaw) {
    const ids = (settings.allowed_users?.telegram_user_ids ?? [])
        .filter(id => id !== 'REPLACE_WITH_YOUR_TELEGRAM_ID')
        .map(Number);
    openclaw.channels.telegram.dmPolicy  = ids.length > 0 ? 'whitelist' : 'open';
    openclaw.channels.telegram.whitelist = ids;
}

const [,, command, targetId] = process.argv;

if (!command || command === 'list') {
    const s = load(SETTINGS);
    console.log('Allowed users:', s.allowed_users?.telegram_user_ids ?? []);
    console.log('Admins:       ', s.admin?.telegram_user_ids ?? []);
    process.exit(0);
}

if (!targetId || isNaN(Number(targetId))) {
    console.error(`Usage: node scripts/add_user.js [add|remove|admin-add|admin-remove|list] <telegram_id>`);
    process.exit(1);
}

const settings = load(SETTINGS);
const openclaw = load(OPENCLAW);
const id       = String(targetId);

if (command === 'add') {
    const list = settings.allowed_users.telegram_user_ids;
    if (!list.includes(id)) list.push(id);
    syncWhitelist(settings, openclaw);
    save(SETTINGS, settings); save(OPENCLAW, openclaw);
    console.log(`✅ User ${id} added to whitelist. Restart HoraMind.`);

} else if (command === 'remove') {
    settings.allowed_users.telegram_user_ids =
        settings.allowed_users.telegram_user_ids.filter(x => x !== id);
    syncWhitelist(settings, openclaw);
    save(SETTINGS, settings); save(OPENCLAW, openclaw);
    console.log(`✅ User ${id} removed from whitelist. Restart HoraMind.`);

} else if (command === 'admin-add') {
    const list = settings.admin.telegram_user_ids;
    if (!list.includes(id)) list.push(id);
    save(SETTINGS, settings);
    console.log(`✅ User ${id} granted admin. No restart needed.`);

} else if (command === 'admin-remove') {
    settings.admin.telegram_user_ids = settings.admin.telegram_user_ids.filter(x => x !== id);
    save(SETTINGS, settings);
    console.log(`✅ User ${id} removed from admin. No restart needed.`);

} else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
