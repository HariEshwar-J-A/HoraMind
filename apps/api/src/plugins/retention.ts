import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';

/**
 * Retention scheduler.
 *
 * The app tells users their chats are permanently deleted after 7 days. That
 * claim needs something to execute it, and the something should not be a cron
 * entry on one machine that nobody notices has stopped.
 *
 * `run_retention()` does the work in the database; this only decides when to
 * call it.
 *
 * ---------------------------------------------------------------------------
 * Why an advisory lock
 * ---------------------------------------------------------------------------
 * Running two API replicas would otherwise mean two concurrent purges. Postgres
 * advisory locks are cheap, held only for the session, and released
 * automatically if the process dies — so a crash mid-purge does not leave
 * retention permanently wedged, which a lock table would.
 *
 * `pg_try_advisory_lock` returns immediately rather than queueing: if another
 * replica is already purging, this one skips the round. There will be another
 * in an hour.
 */

/** Arbitrary but fixed. Any other advisory lock in this database must differ. */
const RETENTION_LOCK_KEY = 8_374_221;

const INTERVAL_MS = 60 * 60 * 1000;

/** Let the process finish starting before doing bulk deletes. */
const INITIAL_DELAY_MS = 60 * 1000;

export interface RetentionOutcome {
    task: string;
    rowsRemoved: number;
}

export async function runRetention(app: FastifyInstance): Promise<RetentionOutcome[] | null> {
    const sql = getDb();

    const [lock] = await sql<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${RETENTION_LOCK_KEY}) AS acquired`;

    if (!lock?.acquired) {
        app.log.debug('retention: another instance holds the lock, skipping');
        return null;
    }

    try {
        const rows = await sql<RetentionOutcome[]>`SELECT * FROM run_retention()`;

        const total = rows.reduce((sum, r) => sum + Number(r.rowsRemoved ?? 0), 0);
        // Logged at info only when something happened. An hourly "removed 0
        // rows" trains people to ignore the line that eventually matters.
        if (total > 0) {
            app.log.info({ retention: rows }, `retention removed ${total} rows`);
        } else {
            app.log.debug({ retention: rows }, 'retention: nothing to remove');
        }

        return rows;
    } finally {
        await sql`SELECT pg_advisory_unlock(${RETENTION_LOCK_KEY})`;
    }
}

export const retentionPlugin = fp(async (app: FastifyInstance) => {
    let timer: NodeJS.Timeout | null = null;

    const tick = async (): Promise<void> => {
        try {
            await runRetention(app);
        } catch (err) {
            // A failed purge must never take the API down. It retries in an
            // hour, and the log line is the signal that something is wrong.
            app.log.error({ err }, 'retention run failed');
        }
    };

    const start = setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), INTERVAL_MS);
        // Do not hold the event loop open on account of the schedule.
        timer.unref();
    }, INITIAL_DELAY_MS);
    start.unref();

    app.addHook('onClose', async () => {
        clearTimeout(start);
        if (timer) clearInterval(timer);
    });

    app.decorate('runRetentionNow', () => runRetention(app));
});

declare module 'fastify' {
    interface FastifyInstance {
        runRetentionNow: () => Promise<RetentionOutcome[] | null>;
    }
}
