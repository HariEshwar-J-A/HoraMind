import { z } from 'zod';
import {
    IsoDateSchema, IsoTimeSchema, LatitudeSchema, LongitudeSchema,
    IanaTimezoneSchema, UuidSchema,
} from './common.js';

/**
 * Birth data and the calculation settings pinned to it.
 *
 * The settings are stored *with the profile* rather than read from a server
 * default at calculation time. Astrology software that silently moves an
 * existing user's chart because an operator changed a default is worse than
 * software that is consistently wrong: the user built an understanding of
 * themselves on the first answer.
 */

export const AYANAMSA_OPTIONS = [
    'true_chitra', 'true_pushya', 'true_revati', 'true_mula',
    'lahiri', 'lahiri_icrc', 'raman', 'kp', 'yukteshwar', 'fagan_bradley',
] as const;

export const HOUSE_SYSTEMS = ['whole_sign', 'equal', 'placidus', 'porphyry'] as const;

/**
 * How much to trust the stated birth time.
 *
 * This is not decoration. The ascendant moves one degree every four minutes, so
 * an unknown birth time makes the ascendant, the house cusps, and everything
 * derived from them meaningless. The UI must say so rather than render a
 * confident wrong chart.
 */
export const TIME_ACCURACY = ['exact', 'approximate', 'unknown'] as const;

export const ChartSettingsSchema = z.object({
    ayanamsa:      z.enum(AYANAMSA_OPTIONS).default('true_chitra'),
    nodeType:      z.enum(['mean', 'true']).default('true'),
    positionMode:  z.enum(['geometric', 'apparent']).default('geometric'),
    houseSystem:   z.enum(HOUSE_SYSTEMS).default('whole_sign'),
    dasamsaScheme: z.enum(['parashara', 'jhora_5_8']).default('parashara'),
    horaScheme:    z.enum(['parashara', 'parivritti']).default('parashara'),
});

export type ChartSettings = z.infer<typeof ChartSettingsSchema>;

export const CreateBirthProfileSchema = z.object({
    label:        z.string().min(1).max(60).default('Me'),
    birthDate:    IsoDateSchema,
    birthTime:    IsoTimeSchema,
    timeAccuracy: z.enum(TIME_ACCURACY).default('exact'),
    placeName:    z.string().min(1).max(160),
    latitude:     LatitudeSchema,
    longitude:    LongitudeSchema,
    timezone:     IanaTimezoneSchema,
    settings:     ChartSettingsSchema.default({}),
    isPrimary:    z.boolean().default(true),
});

export const UpdateBirthProfileSchema = CreateBirthProfileSchema.partial();

export const BirthProfileSchema = CreateBirthProfileSchema.extend({
    id:        UuidSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type BirthProfile = z.infer<typeof BirthProfileSchema>;

/**
 * Place lookup.
 *
 * Resolves a typed place name to coordinates and, critically, an IANA
 * timezone — a birth chart computed in the wrong zone is wrong by the whole
 * offset, which for India is 5.5 hours and roughly five signs of ascendant.
 */
export const PlaceSearchSchema = z.object({
    query: z.string().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const PlaceResultSchema = z.object({
    name:      z.string(),
    country:   z.string(),
    province:  z.string().nullable(),
    latitude:  z.number(),
    longitude: z.number(),
    timezone:  z.string(),
});

export type PlaceResult = z.infer<typeof PlaceResultSchema>;
