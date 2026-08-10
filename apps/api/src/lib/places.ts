import cityTimezones from 'city-timezones';
import { badRequest } from './errors.js';
import type { PlaceResult } from '@horamind/shared';

/**
 * Birth place lookup.
 *
 * Offline, from the `city-timezones` dataset — the same dependency node-jhora
 * already uses. No API key, no rate limit, no per-request cost, and no third
 * party learning where every user was born, which for birth data is the point.
 *
 * What matters most here is the **timezone**, not the coordinates. A chart
 * computed in the wrong zone is wrong by the whole offset: for India that is
 * 5.5 hours, which moves the ascendant by roughly five signs and invalidates
 * every house placement. Coordinates being a few kilometres off shifts the
 * ascendant by seconds of arc; the zone being wrong ruins the chart.
 */

interface CityRecord {
    city: string;
    city_ascii: string;
    country: string;
    iso2: string;
    iso3: string;
    province?: string;
    lat: number;
    lng: number;
    timezone: string;
}

function toResult(c: CityRecord): PlaceResult {
    return {
        name: c.city_ascii || c.city,
        country: c.country,
        province: c.province ?? null,
        latitude: c.lat,
        longitude: c.lng,
        timezone: c.timezone,
    };
}

/**
 * Search cities by name.
 *
 * Results are ordered by how closely the name matches: exact first, then
 * prefix, then substring. Without that ordering, "York" returns a village in
 * Western Australia before York in England, because the dataset is not sorted
 * by anything a user would recognise.
 */
export function searchPlaces(query: string, limit = 10): PlaceResult[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) throw badRequest('Search term must be at least two characters');

    const matches = cityTimezones.findFromCityStateProvince(q) as CityRecord[] | undefined;
    const pool: CityRecord[] = Array.isArray(matches) ? matches : [];

    const rank = (c: CityRecord): number => {
        const name = (c.city_ascii || c.city).toLowerCase();
        if (name === q) return 0;
        if (name.startsWith(q)) return 1;
        if (name.includes(q)) return 2;
        return 3;
    };

    return pool
        .filter(c => c && typeof c.lat === 'number' && typeof c.lng === 'number' && c.timezone)
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, limit)
        .map(toResult);
}

/**
 * Best guess at the IANA timezone for a coordinate pair.
 *
 * Used when a client supplies coordinates from a map or device GPS rather than
 * picking a city. Nearest-city lookup, which is approximate near borders — so
 * the resolved zone is returned to the client for confirmation rather than
 * silently applied to a birth chart.
 */
export function timezoneForCoordinates(latitude: number, longitude: number): string | null {
    const all = cityTimezones.cityMapping as CityRecord[];

    let best: CityRecord | null = null;
    let bestDistance = Infinity;

    for (const c of all) {
        if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || !c.timezone) continue;
        // Squared euclidean distance in degrees: monotonic in true distance at
        // these scales, and avoids a sqrt per row across ~7,000 rows.
        const dLat = c.lat - latitude;
        const dLng = c.lng - longitude;
        const d = dLat * dLat + dLng * dLng;
        if (d < bestDistance) {
            bestDistance = d;
            best = c;
        }
    }

    return best?.timezone ?? null;
}
