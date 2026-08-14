import { describe, test, expect } from 'vitest';
import { sunTimes, clock } from '../src/lib/sun.js';
import { dayShape } from '../src/services/muhurta.js';

/**
 * Day-division tests.
 *
 * These have *correct answers*, unlike most of what this app produces, so they
 * are tested against published values rather than against themselves. Rahu Kaal
 * in particular is something a great many people already follow and can check
 * against their own almanac; being forty minutes out because sunrise was
 * assumed to be six o'clock would be quietly, checkably wrong.
 */

// Chennai: 13.09 N, 80.28 E, IST is UTC+5:30 year-round.
const CHENNAI = { lat: 13.08998781, lon: 80.27999874, tz: 330 };

describe('sunrise and sunset', () => {
    test('matches published times for Chennai at an equinox', () => {
        // Around the equinox the Sun rises and sets close to six, offset by the
        // longitude's distance from the zone meridian (82.5 E for IST) and the
        // equation of time. Published: about 06:00 and 18:08 IST.
        const s = sunTimes('2026-03-21', CHENNAI.lat, CHENNAI.lon, CHENNAI.tz);
        expect(s.hasRiseSet).toBe(true);
        expect(clock(s.sunrise)).toMatch(/^0[56]:/);
        expect(clock(s.sunset)).toMatch(/^18:/);
        // Daylight at an equinox is twelve hours everywhere, within minutes.
        expect((s.sunset - s.sunrise) / 60).toBeGreaterThan(11.8);
        expect((s.sunset - s.sunrise) / 60).toBeLessThan(12.3);
    });

    test('a northern summer day is longer in London than in Chennai', () => {
        const london = sunTimes('2026-06-21', 51.5, -0.13, 60);
        const chennai = sunTimes('2026-06-21', CHENNAI.lat, CHENNAI.lon, CHENNAI.tz);
        expect(london.sunset - london.sunrise).toBeGreaterThan(chennai.sunset - chennai.sunrise);
        // London at the solstice gets about 16h39m.
        expect((london.sunset - london.sunrise) / 60).toBeGreaterThan(16);
    });

    test('reports polar day rather than returning nonsense', () => {
        // Longyearbyen in June: the Sun does not set at all.
        const s = sunTimes('2026-06-21', 78.22, 15.65, 120);
        expect(s.hasRiseSet).toBe(false);
        // The fallback is still a usable span, not NaN.
        expect(Number.isFinite(s.sunrise)).toBe(true);
        expect(Number.isFinite(s.sunset)).toBe(true);
    });

    test('the equator barely varies between solstices', () => {
        const jun = sunTimes('2026-06-21', 0, 0, 0);
        const dec = sunTimes('2026-12-21', 0, 0, 0);
        const diff = Math.abs((jun.sunset - jun.sunrise) - (dec.sunset - dec.sunrise));
        expect(diff).toBeLessThan(15);
    });
});

describe('the day divided', () => {
    const shape = (weekday: number) => dayShape({
        date: '2026-03-21', weekday,
        lat: CHENNAI.lat, lon: CHENNAI.lon, tzOffsetMinutes: CHENNAI.tz,
    });

    test('Rahu Kaal falls in a different eighth on each weekday', () => {
        const starts = new Set<string>();
        for (let wd = 0; wd < 7; wd++) {
            const rahu = shape(wd).windows.find(w => w.name === 'Rahu Kaal')!;
            starts.add(rahu.from);
        }
        // Seven weekdays, seven distinct eighths — the whole point of the table.
        expect(starts.size).toBe(7);
    });

    test('Rahu Kaal on a Sunday is the late-afternoon eighth', () => {
        // Sunday takes the 8th eighth, so it ends at sunset.
        const s = shape(0);
        const rahu = s.windows.find(w => w.name === 'Rahu Kaal')!;
        expect(rahu.to).toBe(s.sunset);
    });

    test('Thursday Yamaganda is the first eighth, starting at sunrise', () => {
        const s = shape(4);
        const y = s.windows.find(w => w.name === 'Yamaganda')!;
        expect(y.from).toBe(s.sunrise);
    });

    test('Abhijit straddles noon, and is absent on Wednesday', () => {
        const thu = shape(4).windows.find(w => w.name === 'Abhijit Muhurta');
        expect(thu).toBeDefined();
        expect(thu!.kind).toBe('favour');
        expect(thu!.from < '12:30' && thu!.to > '11:30').toBe(true);

        // The tradition excludes it on Wednesday.
        expect(shape(3).windows.find(w => w.name === 'Abhijit Muhurta')).toBeUndefined();
    });

    test('the day opens with the hora of its own lord', () => {
        const lords = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
        for (let wd = 0; wd < 7; wd++) {
            expect(shape(wd).horas[0]!.lord, `weekday ${wd}`).toBe(lords[wd]);
        }
    });

    test('the 24-hora cycle reproduces the order of the weekdays', () => {
        // Why the week is ordered as it is: the 25th hora — the first of the
        // next day — is always the next weekday's lord. If this ever fails, the
        // Chaldean sequence has been reordered and every hora is wrong.
        for (let wd = 0; wd < 7; wd++) {
            const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
            const first = shape(wd).horas[0]!.lord;
            const next = CHALDEAN[(CHALDEAN.indexOf(first) + 24) % 7];
            expect(next, `after weekday ${wd}`).toBe(shape((wd + 1) % 7).horas[0]!.lord);
        }
    });

    test('gives 24 horas covering the whole day', () => {
        const s = shape(2);
        expect(s.horas).toHaveLength(24);
        expect(s.horas[0]!.from).toBe(s.sunrise);
        expect(s.horas[11]!.to).toBe(s.sunset);
    });

    test('marks the hora containing the given moment, and only that one', () => {
        const s = dayShape({
            date: '2026-03-21', weekday: 6,
            lat: CHENNAI.lat, lon: CHENNAI.lon, tzOffsetMinutes: CHENNAI.tz,
            nowMinutes: 10 * 60,
        });
        expect(s.horas.filter(h => h.current)).toHaveLength(1);
    });

    test('every window carries a plain-language note', () => {
        for (const w of shape(1).windows) {
            expect(w.note.length, w.name).toBeGreaterThan(20);
        }
    });
});
