import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as notes from '../repos/notifications.js';
import {
    NotificationSchema,
    NotificationPrefsSchema,
    PatchNotificationPrefsSchema,
    PushSubscribeSchema,
} from '@horamind/shared';
import { notFound, serviceUnavailable } from '../lib/errors.js';

/**
 * In-app notifications and the prefs that govern them.
 *
 * Push is optional. If VAPID is unset the subscribe route says so rather than
 * storing a subscription that can never be used; the centre still works.
 */

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.get('/notifications', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            querystring: z.object({ unread: z.enum(['true', 'false']).optional() }),
            response: {
                200: z.object({
                    notifications: z.array(NotificationSchema),
                    unread: z.number(),
                }),
            },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const unreadOnly = req.query.unread === 'true';
        const [rows, unread] = await Promise.all([
            notes.listNotifications(sql, req.user!.id, unreadOnly),
            notes.unreadCount(sql, req.user!.id),
        ]);
        return reply.status(200).send({
            notifications: rows.map(notes.toNotification),
            unread,
        });
    });

    typed.post('/notifications/:id/read', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            params: z.object({ id: z.string().uuid() }),
        },
    }, async (req, reply) => {
        const ok = await notes.markRead(getDb(), req.user!.id, req.params.id);
        if (!ok) throw notFound('Notification');
        return reply.status(204).send();
    });

    typed.post('/notifications/read-all', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
        },
    }, async (req, reply) => {
        await notes.markAllRead(getDb(), req.user!.id);
        return reply.status(204).send();
    });

    typed.get('/notification-prefs', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            response: { 200: NotificationPrefsSchema },
        },
    }, async (req, reply) => {
        const row = await notes.getPrefs(getDb(), req.user!.id);
        return reply.status(200).send({
            kinds: row.kinds,
            quietFrom: row.quietFrom,
            quietTo: row.quietTo,
        });
    });

    typed.patch('/notification-prefs', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            body: PatchNotificationPrefsSchema,
            response: { 200: NotificationPrefsSchema },
        },
    }, async (req, reply) => {
        const row = await notes.upsertPrefs(getDb(), req.user!.id, {
            kinds: req.body.kinds,
            quietFrom: req.body.quietFrom,
            quietTo: req.body.quietTo,
        });
        return reply.status(200).send({
            kinds: row.kinds,
            quietFrom: row.quietFrom,
            quietTo: row.quietTo,
        });
    });

    typed.post('/push/subscribe', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            body: PushSubscribeSchema,
        },
    }, async (req, reply) => {
        const env = loadEnv();
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
            throw serviceUnavailable('Push is not configured on this server');
        }
        await notes.savePush(getDb(), req.user!.id, {
            endpoint: req.body.endpoint,
            p256dh: req.body.keys.p256dh,
            auth: req.body.keys.auth,
        });
        return reply.status(204).send();
    });

    typed.delete('/push/subscribe', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['notifications'],
            security: [{ bearerAuth: [] }],
            querystring: z.object({ endpoint: z.string().url().optional() }),
        },
    }, async (req, reply) => {
        await notes.deletePush(getDb(), req.user!.id, req.query.endpoint);
        return reply.status(204).send();
    });

    typed.get('/push/vapid', {
        schema: {
            tags: ['notifications'],
            description: 'The public VAPID key, or null if push is not configured.',
            response: { 200: z.object({ publicKey: z.string().nullable() }) },
        },
    }, async (_req, reply) => {
        return reply.status(200).send({ publicKey: loadEnv().VAPID_PUBLIC_KEY ?? null });
    });
}
