import postgres from 'postgres';
import type { Env } from '../config/env.js';

/**
 * Database access.
 *
 * `postgres.js` is used directly rather than through an ORM. The migrations in
 * `db/migrations/` are the single definition of the schema, and they use
 * plpgsql triggers, partial unique indexes and functions that an ORM's schema
 * DSL cannot express. Adding an ORM schema on top would create a second
 * definition of the same tables, free to drift from the first.
 *
 * Row shapes are therefore declared as TypeScript interfaces next to the
 * queries that produce them.
 */

export type Sql = postgres.Sql<Record<string, never>>;

let _sql: Sql | null = null;

export function createDb(env: Env): Sql {
    return postgres(env.DATABASE_URL, {
        max: env.DATABASE_POOL_MAX,
        ssl: env.DATABASE_SSL ? 'require' : false,
        // Fail fast rather than queueing forever behind an unreachable database.
        connect_timeout: 10,
        idle_timeout: 30,
        // `postgres.js` maps snake_case to camelCase on request; doing it here
        // keeps the SQL idiomatic and the TypeScript idiomatic at the same time.
        transform: postgres.camel,
        onnotice: () => {},
    });
}

export function getDb(): Sql {
    if (!_sql) throw new Error('Database not initialised. Call initDb() first.');
    return _sql;
}

export function initDb(env: Env): Sql {
    if (!_sql) _sql = createDb(env);
    return _sql;
}

export async function closeDb(): Promise<void> {
    if (_sql) {
        await _sql.end({ timeout: 5 });
        _sql = null;
    }
}

/**
 * Cheap liveness probe.
 *
 * `SELECT 1` rather than a table read: this answers "can I reach the database",
 * which is what a health check should mean. Touching a real table would make
 * the probe fail for reasons unrelated to connectivity.
 */
export async function pingDb(sql: Sql): Promise<boolean> {
    try {
        await sql`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}
