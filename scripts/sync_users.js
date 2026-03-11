/**
 * sync_users.js
 * Syncs the allowed_users list from settings.json → openclaw.json whitelist.
 *
 * Run after adding/removing users:
 *   node scripts/sync_users.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const SETTINGS   = path.join(ROOT, 'settings.json');
const OPENCLAW   = path.join(ROOT, 'openclaw.json');

const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
const openclaw = JSON.parse(fs.readFileSync(OPENCLAW, 'utf8'));

const allowed = (settings?.allowed_users?.telegram_user_ids ?? [])
    .filter(id => id !== 'REPLACE_WITH_YOUR_TELEGRAM_ID')
    .map(id => Number(id));   // openclaw.json whitelist uses numeric IDs

if (allowed.length === 0) {
    console.error('⚠️  No valid user IDs found in settings.json → allowed_users.telegram_user_ids');
    console.error('   Add your Telegram numeric user ID first, then re-run.');
    process.exit(1);
}

openclaw.channels.telegram.dmPolicy  = 'whitelist';
openclaw.channels.telegram.whitelist = allowed;

fs.writeFileSync(OPENCLAW, JSON.stringify(openclaw, null, 4), 'utf8');

console.log('✅ openclaw.json whitelist updated:');
allowed.forEach(id => console.log(`   • ${id}`));
console.log('\nRestart HoraMind to apply changes.');
