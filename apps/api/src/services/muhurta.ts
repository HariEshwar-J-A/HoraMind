import { sunTimes, clock } from '../lib/sun.js';

/**
 * The day, divided.
 *
 * Everything here is arithmetic on the daylight span — no model, no judgement
 * call at runtime. That matters for this feature more than most: "avoid
 * Rahu Kaal" is advice a great many people already follow, and it has a fixed,
 * checkable answer. Generating it would be inventing something that has a
 * correct value.
 *
 * The four inauspicious and one auspicious window are the standard set:
 *
 *   - **Rahu Kaal** — an eighth of daylight, which eighth depending on the
 *     weekday. The most widely observed of the four by a wide margin.
 *   - **Yamaganda** and **Gulika** — the same construction, different eighths.
 *   - **Abhijit** — the eighth of fifteen daytime muhurtas, straddling local
 *     apparent noon. Auspicious for almost anything, and the usual answer to
 *     "when today is good".
 *
 * Plus the **horas**: twenty-four planetary hours from sunrise, each ruled by a
 * graha, cycling in Chaldean order. This is the part with day-to-day use — it
 * says what a particular hour of a particular day is suited to.
 */

/** Which eighth of daylight, indexed by JS weekday (0 = Sunday). */
const RAHU: readonly number[] = [8, 2, 7, 5, 6, 4, 3];
const YAMAGANDA: readonly number[] = [5, 4, 3, 2, 1, 7, 6];
const GULIKA: readonly number[] = [7, 6, 5, 4, 3, 2, 1];

/** The lord of each weekday, 0 = Sunday. */
const DAY_LORD: readonly string[] = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

/**
 * Chaldean order — slowest apparent motion to fastest.
 *
 * The horas run through this cycle continuously, which is also *why* the
 * weekdays are in the order they are: take every 24th hora and you get Sun,
 * Moon, Mars, Mercury, Jupiter, Venus, Saturn. The week is a side-effect of
 * this sequence, which is a pleasing thing to be able to show someone.
 */
const CHALDEAN: readonly string[] = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];

/**
 * What each hora suits.
 *
 * Classical significations, phrased as the ordinary activity rather than the
 * abstraction — "ask for something" rather than "matters of the second house".
 * Deliberately mundane: the value of a hora table is that it applies to a
 * Tuesday afternoon, and abstraction is what stops it being usable.
 */
const HORA_USE: Record<string, { good: string; avoid: string }> = {
    Sun:     { good: 'Dealing with authority, applications, anything official', avoid: 'Asking a favour of someone senior' },
    Moon:    { good: 'Conversations that need care, family, rest, water', avoid: 'Signing anything binding' },
    Mars:    { good: 'Hard physical work, exercise, cutting things short', avoid: 'Arguments and negotiations' },
    Mercury: { good: 'Writing, study, accounts, messages, travel booking', avoid: 'Nothing in particular — a broadly useful hour' },
    Jupiter: { good: 'Teaching, advice, money decisions, beginnings', avoid: 'Nothing in particular — the most forgiving hour' },
    Venus:   { good: 'Anything social, creative or to do with comfort', avoid: 'Heavy or unpleasant tasks' },
    Saturn:  { good: 'Solitary work, repairs, clearing a backlog, endings', avoid: 'Starting something new' },
};

export interface Window {
    name: string;
    from: string;
    to: string;
    kind: 'avoid' | 'favour';
    /** One line on what it is for, in plain words. */
    note: string;
}

export interface Hora {
    lord: string;
    from: string;
    to: string;
    good: string;
    avoid: string;
    /** True for the hora containing the moment this was computed. */
    current?: boolean;
}

export interface DayShape {
    sunrise: string;
    sunset: string;
    /** False in polar day or night, where these divisions do not apply. */
    hasRiseSet: boolean;
    windows: Window[];
    horas: Hora[];
}

/**
 * @param date     `YYYY-MM-DD` at the place.
 * @param weekday  0 = Sunday. Passed in rather than derived, because deriving
 *                 it from a date string is how this codebase got a day-off-by-one
 *                 twice already.
 * @param nowMinutes  minutes from local midnight, for marking the current hora.
 */
export function dayShape(opts: {
    date: string;
    weekday: number;
    lat: number;
    lon: number;
    tzOffsetMinutes: number;
    nowMinutes?: number;
}): DayShape {
    const sun = sunTimes(opts.date, opts.lat, opts.lon, opts.tzOffsetMinutes);
    const dayLength = sun.sunset - sun.sunrise;
    const eighth = dayLength / 8;

    const part = (n: number, name: string, note: string): Window => ({
        name,
        // The eighths are 1-indexed by convention, hence the -1.
        from: clock(sun.sunrise + (n - 1) * eighth),
        to: clock(sun.sunrise + n * eighth),
        kind: 'avoid',
        note,
    });

    const wd = ((opts.weekday % 7) + 7) % 7;

    const windows: Window[] = [
        part(RAHU[wd]!, 'Rahu Kaal',
            'The most widely observed of the inauspicious windows. Avoid starting anything you want to last.'),
        part(YAMAGANDA[wd]!, 'Yamaganda',
            'Traditionally poor for beginnings and for travel.'),
        part(GULIKA[wd]!, 'Gulika Kaal',
            'Whatever begins here is said to repeat, so it is avoided for anything unwelcome.'),
    ];

    // Abhijit: the eighth of fifteen daytime muhurtas, centred on local apparent
    // noon. Omitted on Wednesday, which the tradition excludes.
    if (wd !== 3) {
        const half = dayLength / 30;   // half a muhurta
        windows.push({
            name: 'Abhijit Muhurta',
            from: clock(sun.solarNoon - half),
            to: clock(sun.solarNoon + half),
            kind: 'favour',
            note: 'The most forgiving window of the day. Good for almost anything, and it overrides most other objections.',
        });
    }

    // Twelve day horas from sunrise, twelve night horas from sunset. The first
    // is always ruled by the lord of the weekday.
    const horas: Hora[] = [];
    const start = CHALDEAN.indexOf(DAY_LORD[wd]!);
    const dayHora = dayLength / 12;
    const nightHora = (1440 - dayLength) / 12;

    for (let i = 0; i < 24; i++) {
        const lord = CHALDEAN[(start + i) % 7]!;
        const from = i < 12
            ? sun.sunrise + i * dayHora
            : sun.sunset + (i - 12) * nightHora;
        const to = from + (i < 12 ? dayHora : nightHora);
        const use = HORA_USE[lord]!;

        horas.push({
            lord,
            from: clock(from),
            to: clock(to),
            good: use.good,
            avoid: use.avoid,
            current: opts.nowMinutes !== undefined
                && opts.nowMinutes >= from && opts.nowMinutes < to,
        });
    }

    return {
        sunrise: clock(sun.sunrise),
        sunset: clock(sun.sunset),
        hasRiseSet: sun.hasRiseSet,
        windows,
        horas,
    };
}
