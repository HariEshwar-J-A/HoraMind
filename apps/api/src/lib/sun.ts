/**
 * Sunrise and sunset, from first principles.
 *
 * Everything classical about a *day* — as opposed to a chart — is measured from
 * sunrise: the Vedic day begins there, the planetary horas are twelfths of
 * daylight, and Rahu Kaal is an eighth of it. `services/charts.ts` notes that
 * node-jhora does not expose a rise/set computation and uses 6.0 as a
 * placeholder, which makes every one of those divisions wrong by however far
 * the real sunrise is from six o'clock — in Chennai in December, about forty
 * minutes; in Reykjavik, hours.
 *
 * This is the NOAA solar position algorithm, which is accurate to well under a
 * minute for any latitude that has a sunrise at all. No dependency: it is
 * arithmetic, and a package for it would be a supply-chain risk taken on for
 * fifty lines.
 *
 * Returns minutes from local midnight, so the caller does the timezone work
 * once and this stays a pure function of date and place.
 */

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Days since the J2000.0 epoch, at noon UTC on the given civil date. */
function julianDay(year: number, month: number, day: number): number {
    // Meeus, with January and February treated as months 13 and 14 of the
    // previous year so the leap rule stays a single expression.
    let y = year;
    let m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const a = Math.floor(y / 100);
    const b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716))
        + Math.floor(30.6001 * (m + 1))
        + day + b - 1524.5;
}

export interface SunTimes {
    /** Minutes from local midnight. */
    sunrise: number;
    sunset: number;
    /** Local apparent noon — the midpoint, which Abhijit is centred on. */
    solarNoon: number;
    /** False above the Arctic or Antarctic circle on the relevant dates. */
    hasRiseSet: boolean;
}

/**
 * @param date  `YYYY-MM-DD`, the civil date at the place in question.
 * @param lat   degrees north, negative south.
 * @param lon   degrees east, negative west.
 * @param tzOffsetMinutes  the place's UTC offset on that date, including DST.
 */
export function sunTimes(date: string, lat: number, lon: number, tzOffsetMinutes: number): SunTimes {
    const [y, mo, d] = date.split('-').map(Number);
    const jd = julianDay(y ?? 2000, mo ?? 1, d ?? 1);
    const t = (jd - 2451545) / 36525;   // Julian centuries since J2000

    // Mean and true longitude of the Sun.
    const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    const meanAnom = 357.52911 + t * (35999.05029 - t * 0.0001537);
    const centre = Math.sin(rad(meanAnom)) * (1.914602 - t * (0.004817 + t * 0.000014))
        + Math.sin(rad(2 * meanAnom)) * (0.019993 - t * 0.000101)
        + Math.sin(rad(3 * meanAnom)) * 0.000289;
    const trueLong = meanLong + centre;
    const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));

    // Obliquity of the ecliptic, with the nutation correction.
    const meanObliq = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
    const obliq = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));

    const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(apparentLong))));

    // The equation of time, in minutes: the gap between clock noon and the
    // Sun actually crossing the meridian.
    const varY = Math.tan(rad(obliq / 2)) ** 2;
    const eqTime = 4 * deg(
        varY * Math.sin(2 * rad(meanLong))
        - 2 * 0.016708634 * Math.sin(rad(meanAnom))
        + 4 * 0.016708634 * varY * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong))
        - 0.5 * varY * varY * Math.sin(4 * rad(meanLong))
        - 1.25 * 0.016708634 ** 2 * Math.sin(2 * rad(meanAnom)),
    );

    // -0.833°: the centre of the disc is that far below the horizon when its
    // upper limb appears, once refraction and the Sun's radius are counted.
    const cosH = (Math.cos(rad(90.833)) - Math.sin(rad(lat)) * Math.sin(rad(declination)))
        / (Math.cos(rad(lat)) * Math.cos(rad(declination)));

    const solarNoon = 720 - 4 * lon - eqTime + tzOffsetMinutes;

    // |cos H| > 1 means the Sun neither rises nor sets that day. Polar day and
    // polar night are real places with users, not an error: the caller is told
    // so and falls back rather than rendering NaN o'clock.
    if (cosH > 1 || cosH < -1) {
        return { sunrise: 6 * 60, sunset: 18 * 60, solarNoon, hasRiseSet: false };
    }

    const hourAngle = deg(Math.acos(cosH));
    return {
        sunrise: solarNoon - hourAngle * 4,
        sunset: solarNoon + hourAngle * 4,
        solarNoon,
        hasRiseSet: true,
    };
}

/** Minutes from midnight as `HH:MM`, for a wire format that never needs parsing back. */
export function clock(minutes: number): string {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
