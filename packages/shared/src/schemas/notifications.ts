import { z } from 'zod';
import { UuidSchema } from './common.js';

/**
 * Notification contracts.
 *
 * Kinds default OFF except `system`. Defaulting to on is how an app becomes
 * something people mute. Quiet hours are minutes from midnight in the user's
 * own timezone; the server enforces them at send time.
 */

export const NOTIFICATION_KINDS = [
    'daily_compass', 'dasha_change', 'transit', 'life_stale', 'system',
] as const;

export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationSchema = z.object({
    id: UuidSchema,
    kind: NotificationKindSchema,
    title: z.string(),
    body: z.string(),
    href: z.string().nullable(),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPrefsSchema = z.object({
    kinds: z.record(NotificationKindSchema, z.boolean()),
    quietFrom: z.number().int().min(0).max(1439).nullable(),
    quietTo: z.number().int().min(0).max(1439).nullable(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const PatchNotificationPrefsSchema = z.object({
    kinds: z.record(NotificationKindSchema, z.boolean()).optional(),
    quietFrom: z.number().int().min(0).max(1439).nullable().optional(),
    quietTo: z.number().int().min(0).max(1439).nullable().optional(),
});

export const PushSubscribeSchema = z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
        p256dh: z.string().min(1).max(256),
        auth: z.string().min(1).max(256),
    }),
});
