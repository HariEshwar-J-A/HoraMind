import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

/**
 * One error shape for the whole API.
 *
 * Two rules drive this:
 *
 *   1. Clients switch on `error.code`, never on message text.
 *   2. A 5xx never leaks its message to the caller. Internal errors carry stack
 *      traces, SQL fragments and occasionally connection strings; those go to
 *      the log, and the client gets the request id to quote at support.
 */
export function registerErrorHandler(app: FastifyInstance): void {
    app.setErrorHandler((err, req, reply) => {
        const requestId = req.id;

        if (hasZodFastifySchemaValidationErrors(err)) {
            req.log.info({ err, requestId }, 'request failed validation');
            return reply.status(400).send({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request did not match the expected schema',
                    details: err.validation,
                    requestId,
                },
            });
        }

        if (err instanceof ZodError) {
            return reply.status(400).send({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request did not match the expected schema',
                    details: err.issues,
                    requestId,
                },
            });
        }

        if (err instanceof AppError) {
            // 4xx is the caller's problem and is logged at info; 5xx is ours.
            const level = err.statusCode >= 500 ? 'error' : 'info';
            req.log[level]({ err, requestId, code: err.code }, err.message);
            return reply.status(err.statusCode).send({
                error: {
                    code: err.code,
                    message: err.message,
                    details: err.details,
                    requestId,
                },
            });
        }

        // Fastify's own errors (body too large, unsupported media type, …)
        // already carry a sensible status. The type guard above narrows `err`
        // to `unknown` on this path, so read the fields defensively rather than
        // asserting a shape the compiler cannot confirm.
        const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
        const status = fastifyErr.statusCode ?? 500;
        if (status < 500) {
            req.log.info({ err, requestId }, 'client error');
            return reply.status(status).send({
                error: {
                    code: fastifyErr.code ?? 'BAD_REQUEST',
                    message: fastifyErr.message ?? 'Request could not be processed',
                    requestId,
                },
            });
        }

        req.log.error({ err, requestId }, 'unhandled error');
        return reply.status(500).send({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Something went wrong on our end',
                requestId,
            },
        });
    });

    app.setNotFoundHandler((req, reply) =>
        reply.status(404).send({
            error: {
                code: 'NOT_FOUND',
                message: `No route for ${req.method} ${req.url}`,
                requestId: req.id,
            },
        }),
    );
}
