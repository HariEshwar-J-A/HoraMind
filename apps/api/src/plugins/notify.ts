import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import { detectChanges } from '../services/notify.js';

/**
 * Hourly sky-change detector.
 *
 * Computes today's dasha stack and slow transits per primary profile, compares
 * with the last stored snapshot, and emits on difference. The first run after
 * a profile is created only stores the snapshot — emitting "your dasha has
 * begun" on the day someone signs up would be a notification about nothing.
 *
 * Failures never take the API down. The next hour tries again.
 */

const INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 90 * 1000;

export const notifyPlugin = fp(async (app: FastifyInstance) => {
    let timer: NodeJS.Timeout | null = null;

    const tick = async (): Promise<void> => {
        try {
            const result = await detectChanges(getDb(), loadEnv(), app.log);
            if (result.emitted > 0) {
                app.log.info(result, 'notification detect emitted');
            } else {
                app.log.debug(result, 'notification detect: nothing new');
            }
        } catch (err) {
            app.log.error({ err }, 'notification detect failed');
        }
    };

    const start = setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), INTERVAL_MS);
        timer.unref();
    }, INITIAL_DELAY_MS);
    start.unref();

    app.addHook('onClose', async () => {
        clearTimeout(start);
        if (timer) clearInterval(timer);
    });

    app.decorate('runNotifyDetectNow', () => tick());
});

declare module 'fastify' {
    interface FastifyInstance {
        runNotifyDetectNow: () => Promise<void>;
    }
}
