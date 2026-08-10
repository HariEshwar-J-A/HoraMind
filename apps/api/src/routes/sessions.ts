import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { SessionSummarySchema, RevokeSessionsSchema } from '@horamind/shared';
import { getDb } from '../db/client.js';
import { listSessions, revokeSession, revokeAllSessions } from '../repos/sessions.js';
import { notFound, badRequest } from '../lib/errors.js';

/**
 * Device management.
 *
 * The product asked for no sessions but for the ability to sign out of a chosen
 * device or all of them. Those are the same feature: revoking one device
 * requires the server to know the devices exist. What the user never sees is a
 * session — they see a list of places they are signed in, which is the useful
 * form of the same fact.
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/sessions', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['sessions'],
            description: 'Devices currently signed in.',
            security: [{ bearerAuth: [] }],
            response: { 200: z.object({ sessions: z.array(SessionSummarySchema) }) },
        },
    }, async (req, reply) => {
        const rows = await listSessions(getDb(), req.user!.id);
        return reply.status(200).send({
            sessions: rows.map(s => ({
                id: s.id,
                label: s.deviceLabel,
                platform: s.platform,
                appVersion: s.appVersion,
                createdAt: s.createdAt.toISOString(),
                lastSeenAt: s.lastSeenAt.toISOString(),
                // Lets the UI label one entry "This device" and warn before
                // revoking it, rather than signing the user out by surprise.
                current: s.id === req.user!.sessionId,
            })),
        });
    });

    typed.post('/sessions/revoke', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['sessions'],
            description:
                'Revoke one device, or every device. Revoking all includes the current one, '
                + 'so the caller is signed out too.',
            security: [{ bearerAuth: [] }],
            body: RevokeSessionsSchema,
            response: { 200: z.object({ revoked: z.number(), signedOutSelf: z.boolean() }) },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const { id: userId, sessionId } = req.user!;

        if (req.body.all) {
            const revoked = await revokeAllSessions(sql, userId);
            return reply.status(200).send({ revoked, signedOutSelf: true });
        }

        // "Neither a target nor `all`" is ambiguous, and guessing either way
        // risks signing someone out of more than they meant.
        if (!req.body.sessionId) {
            throw badRequest('Provide "sessionId", or set "all" to true');
        }

        const ok = await revokeSession(sql, userId, req.body.sessionId);
        if (!ok) throw notFound('Session');

        return reply.status(200).send({
            revoked: 1,
            signedOutSelf: req.body.sessionId === sessionId,
        });
    });
}
