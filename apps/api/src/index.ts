import { loadEnv } from './config/env.js';
import { buildServer, initResources } from './server.js';
import { closeDb } from './db/client.js';

/**
 * Process entry point.
 *
 * Startup order matters: configuration is validated first so a misconfigured
 * deploy fails immediately and visibly, then dependencies are initialised, and
 * only then does the server bind a port. Binding first would let an
 * orchestrator route traffic to a process that cannot serve it.
 */
async function main(): Promise<void> {
    const env = loadEnv();

    await initResources(env);

    const app = await buildServer(env);

    /**
     * Graceful shutdown.
     *
     * On SIGTERM the orchestrator has already stopped sending new requests but
     * in-flight ones are still running. Closing the server drains them; only
     * then is it safe to close the database. The timeout exists because a
     * request wedged on a slow upstream must not block the deploy forever.
     */
    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        app.log.info({ signal }, 'shutting down');

        const force = setTimeout(() => {
            app.log.error('graceful shutdown timed out; forcing exit');
            process.exit(1);
        }, 15_000);
        force.unref();

        try {
            await app.close();
            await closeDb();
            app.log.info('shutdown complete');
            process.exit(0);
        } catch (err) {
            app.log.error({ err }, 'error during shutdown');
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT',  () => void shutdown('SIGINT'));

    // An unhandled rejection leaves the process in an unknown state. Log it and
    // let the orchestrator restart cleanly rather than serve from a bad one.
    process.on('unhandledRejection', err => {
        app.log.fatal({ err }, 'unhandled rejection');
        void shutdown('unhandledRejection');
    });

    await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
});
