import type { Sql } from '../db/client.js';
import type { BirthProfile, ChartSettings } from '@horamind/shared';

/**
 * Birth profile persistence.
 *
 * Each profile carries its own calculation settings. They are copied in at
 * creation and never re-read from a server default, so changing a default
 * cannot move a chart a user has already seen and built an understanding of.
 */

export interface ProfileRow {
    id: string;
    userId: string;
    label: string;
    isPrimary: boolean;
    birthDate: string;
    birthTime: string;
    timeAccuracy: 'exact' | 'approximate' | 'unknown';
    placeName: string;
    latitude: string;
    longitude: string;
    timezone: string;
    ayanamsa: string;
    nodeType: string;
    positionMode: string;
    houseSystem: string;
    dasamsaScheme: string;
    horaScheme: string;
    createdAt: Date;
    updatedAt: Date;
}

/** Postgres returns `numeric` as a string to avoid float loss; parse at the edge. */
export function toBirthProfile(r: ProfileRow): BirthProfile {
    return {
        id: r.id,
        label: r.label,
        isPrimary: r.isPrimary,
        birthDate: typeof r.birthDate === 'string' ? r.birthDate : String(r.birthDate),
        birthTime: r.birthTime,
        timeAccuracy: r.timeAccuracy,
        placeName: r.placeName,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        timezone: r.timezone,
        settings: {
            ayanamsa: r.ayanamsa,
            nodeType: r.nodeType,
            positionMode: r.positionMode,
            houseSystem: r.houseSystem,
            dasamsaScheme: r.dasamsaScheme,
            horaScheme: r.horaScheme,
        } as ChartSettings,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
    };
}

const COLUMNS = `id, user_id, label, is_primary, birth_date, birth_time, time_accuracy,
                 place_name, latitude, longitude, timezone, ayanamsa, node_type,
                 position_mode, house_system, dasamsa_scheme, hora_scheme,
                 created_at, updated_at`;

export async function listProfiles(sql: Sql, userId: string): Promise<ProfileRow[]> {
    return sql<ProfileRow[]>`
        SELECT ${sql.unsafe(COLUMNS)} FROM birth_profiles
         WHERE user_id = ${userId}
         ORDER BY is_primary DESC, created_at`;
}

export async function findProfile(sql: Sql, userId: string, id: string): Promise<ProfileRow | null> {
    const [row] = await sql<ProfileRow[]>`
        SELECT ${sql.unsafe(COLUMNS)} FROM birth_profiles
         WHERE id = ${id} AND user_id = ${userId}`;
    return row ?? null;
}

export async function findPrimaryProfile(sql: Sql, userId: string): Promise<ProfileRow | null> {
    const [row] = await sql<ProfileRow[]>`
        SELECT ${sql.unsafe(COLUMNS)} FROM birth_profiles
         WHERE user_id = ${userId} AND is_primary
         LIMIT 1`;
    return row ?? null;
}

export interface CreateProfileInput {
    label: string;
    birthDate: string;
    birthTime: string;
    timeAccuracy: string;
    placeName: string;
    latitude: number;
    longitude: number;
    timezone: string;
    settings: ChartSettings;
    isPrimary: boolean;
}

/**
 * Create a profile.
 *
 * Promoting one to primary demotes the rest in the same transaction. A partial
 * unique index enforces at most one primary per user, so doing this in two
 * statements outside a transaction would intermittently violate it under
 * concurrent requests.
 */
export async function createProfile(
    sql: Sql,
    userId: string,
    input: CreateProfileInput,
): Promise<ProfileRow> {
    return sql.begin(async tx => {
        if (input.isPrimary) {
            await tx`UPDATE birth_profiles SET is_primary = false
                      WHERE user_id = ${userId} AND is_primary`;
        }

        const [row] = await tx<ProfileRow[]>`
            INSERT INTO birth_profiles
                (user_id, label, is_primary, birth_date, birth_time, time_accuracy,
                 place_name, latitude, longitude, timezone,
                 ayanamsa, node_type, position_mode, house_system,
                 dasamsa_scheme, hora_scheme)
            VALUES (${userId}, ${input.label}, ${input.isPrimary}, ${input.birthDate},
                    ${input.birthTime}, ${input.timeAccuracy}, ${input.placeName},
                    ${input.latitude}, ${input.longitude}, ${input.timezone},
                    ${input.settings.ayanamsa}, ${input.settings.nodeType},
                    ${input.settings.positionMode}, ${input.settings.houseSystem},
                    ${input.settings.dasamsaScheme}, ${input.settings.horaScheme})
            RETURNING ${tx.unsafe(COLUMNS)}`;

        if (!row) throw new Error('Profile insert returned no row');
        return row;
    }) as Promise<ProfileRow>;
}

export async function updateProfile(
    sql: Sql,
    userId: string,
    id: string,
    patch: Partial<CreateProfileInput>,
): Promise<ProfileRow | null> {
    return sql.begin(async tx => {
        if (patch.isPrimary) {
            await tx`UPDATE birth_profiles SET is_primary = false
                      WHERE user_id = ${userId} AND is_primary AND id <> ${id}`;
        }

        const s = patch.settings;
        const [row] = await tx<ProfileRow[]>`
            UPDATE birth_profiles SET
                label          = COALESCE(${patch.label ?? null}, label),
                is_primary     = COALESCE(${patch.isPrimary ?? null}, is_primary),
                birth_date     = COALESCE(${patch.birthDate ?? null}, birth_date),
                birth_time     = COALESCE(${patch.birthTime ?? null}, birth_time),
                time_accuracy  = COALESCE(${patch.timeAccuracy ?? null}, time_accuracy),
                place_name     = COALESCE(${patch.placeName ?? null}, place_name),
                latitude       = COALESCE(${patch.latitude ?? null}, latitude),
                longitude      = COALESCE(${patch.longitude ?? null}, longitude),
                timezone       = COALESCE(${patch.timezone ?? null}, timezone),
                ayanamsa       = COALESCE(${s?.ayanamsa ?? null}, ayanamsa),
                node_type      = COALESCE(${s?.nodeType ?? null}, node_type),
                position_mode  = COALESCE(${s?.positionMode ?? null}, position_mode),
                house_system   = COALESCE(${s?.houseSystem ?? null}, house_system),
                dasamsa_scheme = COALESCE(${s?.dasamsaScheme ?? null}, dasamsa_scheme),
                hora_scheme    = COALESCE(${s?.horaScheme ?? null}, hora_scheme),
                updated_at     = now()
             WHERE id = ${id} AND user_id = ${userId}
            RETURNING ${tx.unsafe(COLUMNS)}`;

        return row ?? null;
    }) as Promise<ProfileRow | null>;
}

export async function deleteProfile(sql: Sql, userId: string, id: string): Promise<boolean> {
    const rows = await sql`
        DELETE FROM birth_profiles WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
}
