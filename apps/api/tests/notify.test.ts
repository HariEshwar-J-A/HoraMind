import { describe, test, expect } from 'vitest';
import { inQuietHours, kindEnabled } from '../src/services/notify.js';

/**
 * Notification policy tests.
 *
 * The detector itself needs Postgres and the ephemeris; what is wrong-able
 * without them is the policy: quiet hours wrapping midnight, and the default
 * of off-for-everything-but-system.
 */

describe('quiet hours', () => {
    test('a window that does not wrap midnight', () => {
        // 22:00–07:00 is the wrapping case; 01:00–06:00 is the simple one.
        expect(inQuietHours(3 * 60, 60, 6 * 60)).toBe(true);
        expect(inQuietHours(8 * 60, 60, 6 * 60)).toBe(false);
        expect(inQuietHours(60, 60, 6 * 60)).toBe(true);
        expect(inQuietHours(6 * 60, 60, 6 * 60)).toBe(false);
    });

    test('a window that wraps midnight', () => {
        expect(inQuietHours(23 * 60, 22 * 60, 7 * 60)).toBe(true);
        expect(inQuietHours(2 * 60, 22 * 60, 7 * 60)).toBe(true);
        expect(inQuietHours(12 * 60, 22 * 60, 7 * 60)).toBe(false);
        expect(inQuietHours(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    });

    test('unset quiet hours never suppress', () => {
        expect(inQuietHours(3 * 60, null, null)).toBe(false);
        expect(inQuietHours(3 * 60, 22 * 60, null)).toBe(false);
    });

    test('from === to is treated as no window, not as all day', () => {
        expect(inQuietHours(12 * 60, 0, 0)).toBe(false);
    });
});

describe('kind opt-in', () => {
    test('everything but system is off until the user says otherwise', () => {
        expect(kindEnabled({}, 'system')).toBe(true);
        expect(kindEnabled({}, 'dasha_change')).toBe(false);
        expect(kindEnabled({}, 'daily_compass')).toBe(false);
        expect(kindEnabled({}, 'transit')).toBe(false);
        expect(kindEnabled({}, 'life_stale')).toBe(false);
    });

    test('an explicit false on system is honoured', () => {
        expect(kindEnabled({ system: false }, 'system')).toBe(false);
    });

    test('an explicit true opts a kind in', () => {
        expect(kindEnabled({ dasha_change: true }, 'dasha_change')).toBe(true);
        expect(kindEnabled({ dasha_change: true }, 'transit')).toBe(false);
    });
});
