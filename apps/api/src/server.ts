import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';

import { loadEnv, corsOrigins, type Env } from './config/env.js';
import { initDb } from './db/client.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { sessionRoutes } from './routes/sessions.js';
import { profileRoutes } from './routes/profiles.js';
import { memoryRoutes } from './routes/memories.js';
import { chartRoutes } from './routes/charts.js';
import { ragRoutes } from './routes/rag.js';
import { interpretRoutes } from './routes/interpret.js';
import { chatRoutes } from './routes/chat.js';
import { compassRoutes } from './routes/compass.js';
import { calendarRoutes } from './routes/calendar.js';
import { lifeRoutes } from './routes/life.js';
import { retentionPlugin } from './plugins/retention.js';

/**
 * Fastify application factory.
 *
 * Kept separate from the process entry point so tests can build a server,
 * inject requests into it, and close it without binding a port.
 */
export async function buildServer(env: Env = loadEnv()): Promise<FastifyInstance> {
    const app = Fastify({
        // A request id on every log line and every error response is what makes
        // "it failed at 3pm" a searchable question rather than a guess.
        genReqId: req => (req.headers['x-request-id'] as string) ?? randomUUID(),
        requestIdHeader: 'x-request-id',
        logger: {
            level: env.LOG_LEVEL,
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
            redact: {
                // These appear in request bodies and headers and must never
                // reach the log store, which has a different retention policy
                // and a wider audience than the database.
                paths: [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'req.body.password',
                    'req.body.newPassword',
                    'req.body.idToken',
                    'req.body.refreshToken',
                ],
                censor: '[redacted]',
            },
        },
        // Without this, every client IP behind Caddy or an ingress reads as the
        // proxy — which silently merges all users into one rate-limit bucket.
        trustProxy: env.TRUST_PROXY,
        bodyLimit: 1_048_576,
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(helmet, {
        // The API serves JSON, not documents; CSP matters for the Swagger UI only.
        contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    });

    // Needed to read the httpOnly refresh cookie a browser client relies on.
    await app.register(cookie);

    await app.register(cors, {
        origin: corsOrigins(env),
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });

    /**
     * Coarse network-level rate limit. This is abuse protection, not the
     * product quota — per-user tier limits are enforced against
     * `usage_counters` inside the routes that consume them, because those must
     * be atomic and survive a restart.
     */
    await app.register(rateLimit, {
        max: 300,
        timeWindow: '1 minute',
        keyGenerator: req => (req.user?.id ?? req.ip),
    });

    await app.register(swagger, {
        openapi: {
            info: {
                title: 'HoraMind API',
                description: 'Vedic astrology computation, retrieval and interpretation.',
                version: '2.0.0',
            },
            servers: [{ url: env.PUBLIC_BASE_URL }],
            components: {
                securitySchemes: {
                    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
                },
            },
        },
        transform: jsonSchemaTransform,
    });

    if (env.NODE_ENV !== 'production') {
        await app.register(swaggerUi, { routePrefix: '/docs' });
    }

    registerErrorHandler(app);

    await app.register(authPlugin);

    // Scheduled hard-deletes. Registered only outside tests, so a suite never
    // starts a timer that outlives the assertions it was built for.
    if (env.NODE_ENV !== 'test') await app.register(retentionPlugin);

    await app.register(healthRoutes);
    await app.register(authRoutes,    { prefix: '/v1' });
    await app.register(sessionRoutes, { prefix: '/v1' });
    await app.register(profileRoutes, { prefix: '/v1' });
    await app.register(memoryRoutes,  { prefix: '/v1' });
    await app.register(chartRoutes,   { prefix: '/v1' });
    await app.register(ragRoutes,     { prefix: '/v1' });
    await app.register(interpretRoutes, { prefix: '/v1' });
    await app.register(chatRoutes,    { prefix: '/v1' });
    await app.register(compassRoutes, { prefix: '/v1' });
    await app.register(calendarRoutes, { prefix: '/v1' });
    await app.register(lifeRoutes,     { prefix: '/v1' });

    return app;
}

/** Initialise shared resources that routes assume are already up. */
export async function initResources(env: Env = loadEnv()): Promise<void> {
    initDb(env);
    const { initEngine } = await import('./lib/engine.js');
    await initEngine();
}
