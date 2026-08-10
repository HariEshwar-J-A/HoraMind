import type { FastifyInstance } from 'fastify';
import { getDb, pingDb } from '../db/client.js';
import { isEngineReady } from '../lib/engine.js';

/**
 * Liveness and readiness.
 *
 * These are deliberately different checks, because an orchestrator does
 * different things with them:
 *
 *   - `/health` answers "is this process alive". It must not touch the database.
 *     If it did, a brief database blip would make Kubernetes kill every healthy
 *     pod and turn a recoverable incident into an outage.
 *   - `/ready` answers "can this process serve traffic". It checks the
 *     dependencies, and a failure removes the pod from the load balancer
 *     without restarting it.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
    const startedAt = Date.now();

    app.get('/health', {
        schema: {
            description: 'Liveness probe. Never touches dependencies.',
            tags: ['system'],
        },
    }, async () => ({
        status: 'ok',
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        version: process.env.npm_package_version ?? 'dev',
    }));

    app.get('/ready', {
        schema: {
            description: 'Readiness probe. Verifies database and ephemeris engine.',
            tags: ['system'],
        },
    }, async (_req, reply) => {
        const checks = {
            database: await pingDb(getDb()),
            ephemeris: isEngineReady(),
        };

        const ready = Object.values(checks).every(Boolean);
        return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'degraded', checks });
    });
}
