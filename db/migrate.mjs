#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   node db/migrate.mjs            apply every pending migration
 *   node db/migrate.mjs --status   list applied and pending, change nothing
 *   node db/migrate.mjs --dry-run  show what would run
 *
 * Deliberately small. Migrations are plain `.sql` files applied in filename
 * order, each inside a transaction, each recorded in `schema_migrations` with a
 * checksum.
 *
 * The checksum is the point: editing a migration that has already run is one of
 * the easiest ways to end up with two environments whose schemas differ while
 * both claim to be up to date. This refuses to proceed when a file's contents
 * no longer match what was applied.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

const sha256 = text => createHash('sha256').update(text).digest('hex');

async function loadMigrations() {
    const files = (await readdir(MIGRATIONS_DIR))
        .filter(f => f.endsWith('.sql'))
        .sort();

    return Promise.all(files.map(async name => {
        const body = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
        return { name, body, checksum: sha256(body) };
    }));
}

async function ensureTable(sql) {
    await sql`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name        text        PRIMARY KEY,
            checksum    text        NOT NULL,
            applied_at  timestamptz NOT NULL DEFAULT now(),
            duration_ms integer
        )`;
}

async function main() {
    const args = process.argv.slice(2);
    const statusOnly = args.includes('--status');
    const dryRun = args.includes('--dry-run');

    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    const sql = postgres(url, { max: 1, onnotice: () => {} });

    try {
        await ensureTable(sql);

        const applied = new Map(
            (await sql`SELECT name, checksum FROM schema_migrations`)
                .map(r => [r.name, r.checksum]),
        );
        const migrations = await loadMigrations();

        // Verify history before changing anything: a modified migration means
        // the recorded history is a lie, and continuing would compound it.
        const tampered = migrations.filter(
            m => applied.has(m.name) && applied.get(m.name) !== m.checksum,
        );
        if (tampered.length) {
            console.error('Applied migrations have been modified since they ran:');
            for (const m of tampered) console.error(`  ${m.name}`);
            console.error('\nWrite a new migration instead of editing an applied one.');
            process.exit(1);
        }

        const pending = migrations.filter(m => !applied.has(m.name));

        if (statusOnly || dryRun) {
            console.log(`applied: ${applied.size}, pending: ${pending.length}`);
            for (const m of migrations) {
                console.log(`  ${applied.has(m.name) ? '[x]' : '[ ]'} ${m.name}`);
            }
            return;
        }

        if (!pending.length) {
            console.log('Database is up to date.');
            return;
        }

        for (const m of pending) {
            const started = Date.now();
            process.stdout.write(`applying ${m.name} ... `);
            // `sql.begin` rolls the whole file back on failure, so a migration
            // never lands half-applied.
            await sql.begin(async tx => {
                await tx.unsafe(m.body);
                await tx`
                    INSERT INTO schema_migrations (name, checksum, duration_ms)
                    VALUES (${m.name}, ${m.checksum}, ${Date.now() - started})`;
            });
            console.log(`ok (${Date.now() - started} ms)`);
        }

        console.log(`Applied ${pending.length} migration(s).`);
    } finally {
        await sql.end({ timeout: 5 });
    }
}

main().catch(err => {
    console.error('\nMigration failed:', err.message ?? err);
    process.exit(1);
});
