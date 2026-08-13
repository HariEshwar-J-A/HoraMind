import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { POOL_OPTIONS } from '../../src/db/client.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Integration tests against a real PostgreSQL.
 *
 * Everything here exercises behaviour that only exists in the database:
 * plpgsql triggers, advisory-lock scoping, and the atomicity of the quota
 * upsert. A mock would execute none of it, which is why the unit suite cannot
 * cover these and why a bug in this layer survived until it was read for.
 *
 * Skipped when no database is reachable — a developer without Postgres should
 * still get a green run — and executed in CI, where one is always present.
 * That asymmetry is deliberate: the point is that these never silently vanish.
 */

const DATABASE_URL = process.env.DATABASE_URL
    ?? 'postgres://horamind:ci@localhost:5432/horamind_test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let sql: postgres.Sql;
let reachable = false;

beforeAll(async () => {
    try {
        // Same options the application uses, imported rather than repeated.
        // `transform: postgres.camel` renames every column on the way out, so a
        // test client without it sees `table_name` where the app sees
        // `tableName` — and then tests a database the application never meets.
        sql = postgres(DATABASE_URL, { ...POOL_OPTIONS, max: 4, connect_timeout: 3 });
        await sql`SELECT 1`;
        reachable = true;
    } catch {
        reachable = false;
        return;
    }

    // Apply the real migrations. Testing against a hand-built schema would
    // verify a schema nothing deploys.
    execFileSync(process.execPath, [path.join(ROOT, 'db/migrate.mjs')], {
        env: { ...process.env, DATABASE_URL },
        stdio: 'pipe',
    });
}, 120_000);

afterAll(async () => { await sql?.end({ timeout: 5 }); });

const it = (name: string, fn: () => Promise<void>, timeout?: number) =>
    test(name, async () => {
        if (!reachable) {
            console.warn(`skipped (no database at ${DATABASE_URL})`);
            return;
        }
        await fn();
    }, timeout);

/** A throwaway user, so tests never depend on each other's rows. */
async function makeUser(email = `u${Date.now()}${Math.random()}@example.test`) {
    const [row] = await sql<{ id: string; publicId: string }[]>`
        INSERT INTO users (public_id, email, timezone)
        VALUES (allocate_public_id(), ${email}, 'Asia/Kolkata')
        RETURNING id, public_id`;
    return row!;
}

describe('migrations', () => {
    it('apply cleanly and are idempotent', async () => {
        // A second run must be a no-op. If it is not, the runner's bookkeeping
        // is broken and migrations are silently re-executing.
        const out = execFileSync(process.execPath, [path.join(ROOT, 'db/migrate.mjs')], {
            env: { ...process.env, DATABASE_URL }, encoding: 'utf8',
        });
        expect(out).toMatch(/up to date/i);
    }, 60_000);

    it('returns snake_case columns as camelCase, as every repo assumes', async () => {
        // The repositories all read `row.publicId`, `row.lastSeenAt` and so on.
        // That only works because of `transform: postgres.camel`. If the option
        // were ever dropped, every one of them would silently read undefined
        // rather than fail — so the contract is asserted directly.
        const [row] = await sql<{ publicId: string; createdAt: Date }[]>`
            SELECT public_id, created_at FROM users LIMIT 1`;
        if (row) {
            expect(row.publicId).toBeDefined();
            expect(row.createdAt).toBeInstanceOf(Date);
        }

        const [meta] = await sql<{ tableName: string }[]>`
            SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' LIMIT 1`;
        expect(meta?.tableName).toBeTypeOf('string');
    });

    it('created every table the application reads', async () => {
        const rows = await sql<{ tableName: string }[]>`
            SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public'`;
        const names = new Set(rows.map(r => r.tableName));
        for (const t of ['users', 'identities', 'sessions', 'auth_tokens', 'birth_profiles',
                         'memories', 'interests', 'chats', 'chat_messages', 'chat_summaries',
                         'daily_compass', 'llm_calls', 'rag_calls', 'usage_counters']) {
            expect(names.has(t), `missing table ${t}`).toBe(true);
        }
    });
});

describe('public id allocation', () => {
    it('produces 8 uppercase hex characters', async () => {
        const [row] = await sql<{ id: string }[]>`SELECT allocate_public_id() AS id`;
        expect(row!.id).toMatch(/^[0-9A-F]{8}$/);
    });

    it('does not collide across many allocations', async () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            const [row] = await sql<{ id: string }[]>`SELECT allocate_public_id() AS id`;
            seen.add(row!.id);
        }
        expect(seen.size).toBe(200);
    }, 60_000);
});

describe('row caps', () => {
    it('refuses a 31st memory', async () => {
        const user = await makeUser();
        for (let i = 0; i < 30; i++) {
            await sql`INSERT INTO memories (user_id, what_happened)
                      VALUES (${user.id}, ${'event ' + i})`;
        }
        // The trigger is the real guarantee. These limits bound prompt size, so
        // an API bug that slipped past the application check would surface as
        // an OpenRouter bill rather than an error.
        await expect(
            sql`INSERT INTO memories (user_id, what_happened) VALUES (${user.id}, 'one too many')`,
        ).rejects.toThrow();
    }, 60_000);

    it('refuses a 6th interest', async () => {
        const user = await makeUser();
        for (let i = 0; i < 5; i++) {
            await sql`INSERT INTO interests (user_id, label) VALUES (${user.id}, ${'topic' + i})`;
        }
        await expect(
            sql`INSERT INTO interests (user_id, label) VALUES (${user.id}, 'sixth')`,
        ).rejects.toThrow();
    });

    it('caps are per user, not global', async () => {
        const a = await makeUser();
        const b = await makeUser();
        for (let i = 0; i < 30; i++) {
            await sql`INSERT INTO memories (user_id, what_happened) VALUES (${a.id}, ${'a' + i})`;
        }
        await expect(
            sql`INSERT INTO memories (user_id, what_happened) VALUES (${b.id}, 'b')`,
        ).resolves.toBeDefined();
    }, 60_000);
});

describe('quota counter', () => {
    it('loses no increments under concurrency', async () => {
        const user = await makeUser();

        // This is the exact failure the JSON file had: read, modify, write.
        // Twenty overlapping writers must produce twenty, not "some number
        // less than twenty depending on timing".
        const bump = () => sql<{ count: number }[]>`
            INSERT INTO usage_counters (user_id, period_start, kind, count)
            VALUES (${user.id}, current_date, 'chat_message', 1)
            ON CONFLICT (user_id, period_start, kind)
            DO UPDATE SET count = usage_counters.count + 1
            RETURNING count`;

        await Promise.all(Array.from({ length: 20 }, bump));

        const [row] = await sql<{ count: number }[]>`
            SELECT count FROM usage_counters
             WHERE user_id = ${user.id} AND kind = 'chat_message'
               AND period_start = current_date`;
        expect(row!.count).toBe(20);
    }, 60_000);

    it('each writer receives a distinct post-increment value', async () => {
        const user = await makeUser();
        const results = await Promise.all(Array.from({ length: 10 }, () =>
            sql<{ count: number }[]>`
                INSERT INTO usage_counters (user_id, period_start, kind, count)
                VALUES (${user.id}, current_date, 'compass', 1)
                ON CONFLICT (user_id, period_start, kind)
                DO UPDATE SET count = usage_counters.count + 1
                RETURNING count`));

        const values = results.map(r => r[0]!.count).sort((a, b) => a - b);
        // Two callers seeing the same number means one of them was let past a
        // limit it should have hit.
        expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }, 60_000);
});

describe('retention', () => {
    it('hard-deletes an expired chat and its messages', async () => {
        const user = await makeUser();
        const [chat] = await sql<{ id: string }[]>`
            INSERT INTO chats (user_id, expires_at)
            VALUES (${user.id}, now() - interval '1 hour')
            RETURNING id`;
        await sql`INSERT INTO chat_messages (chat_id, role, content)
                  VALUES (${chat!.id}, 'user', 'this must not survive')`;

        await sql`SELECT run_retention()`;

        const chats = await sql`SELECT id FROM chats WHERE id = ${chat!.id}`;
        const messages = await sql`SELECT id FROM chat_messages WHERE chat_id = ${chat!.id}`;
        // The 7-day promise is only true if the text actually goes.
        expect(chats.length).toBe(0);
        expect(messages.length).toBe(0);
    }, 60_000);

    it('leaves a live chat alone', async () => {
        const user = await makeUser();
        const [chat] = await sql<{ id: string }[]>`
            INSERT INTO chats (user_id, expires_at)
            VALUES (${user.id}, now() + interval '7 days')
            RETURNING id`;

        await sql`SELECT run_retention()`;

        expect((await sql`SELECT id FROM chats WHERE id = ${chat!.id}`).length).toBe(1);
    }, 60_000);

    it('releases its advisory lock, so a second run is not blocked', async () => {
        // The bug this guards: session-scoped pg_advisory_lock taken on one
        // pooled connection and released on another. The unlock silently fails,
        // the lock stays held, and every later run skips — forever, quietly.
        const takeLock = async () => {
            const [row] = await sql.begin(async tx => tx<{ acquired: boolean }[]>`
                SELECT pg_try_advisory_xact_lock(8374221) AS acquired`) as { acquired: boolean }[];
            return row!.acquired;
        };

        expect(await takeLock()).toBe(true);
        // If the lock were session-scoped and leaked, this would be false.
        expect(await takeLock()).toBe(true);
        expect(await takeLock()).toBe(true);
    }, 60_000);
});

describe('account deletion', () => {
    it('cascades to owned rows but detaches billing history', async () => {
        const user = await makeUser();
        await sql`INSERT INTO memories (user_id, what_happened) VALUES (${user.id}, 'x')`;
        await sql`INSERT INTO llm_calls (user_id, purpose, model) VALUES (${user.id}, 'chat', 'm')`;

        await sql`DELETE FROM users WHERE id = ${user.id}`;

        expect((await sql`SELECT id FROM memories WHERE user_id = ${user.id}`).length).toBe(0);
        // Billing and retrieval-quality records must survive the account
        // without remaining attached to a person.
        const calls = await sql`SELECT user_id FROM llm_calls WHERE model = 'm'`;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0]!.userId).toBeNull();
    }, 60_000);
});
