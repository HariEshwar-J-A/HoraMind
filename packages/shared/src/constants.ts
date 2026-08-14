/**
 * Product limits and tier definitions.
 *
 * These live in the shared package because the mobile app has to show the same
 * numbers it is enforced against — a client that lets a user type a 31st memory
 * and then fails on submit is a worse experience than one that says "30 of 30".
 *
 * The caps are additionally enforced by database triggers (see
 * `db/migrations/0001_init.sql`), because they are a cost control on prompt
 * size: a bug that exceeded them would surface as an OpenRouter bill rather
 * than an error.
 */

/** User-facing product name. Package names stay `@horamind/*`. */
export const APP_NAME = 'iAstro';

/**
 * The claim that is actually true.
 *
 * Superlatives ("the only free astrology app") are rejected by store review
 * and trivially falsifiable. This sentence is backed by the README.
 */
export const APP_TAGLINE = 'Free. No ads. No data sale. Conversations deleted after 7 days.';

export const TIERS = ['free', 'plus', 'pro'] as const;
export type Tier = (typeof TIERS)[number];

export interface TierLimits {
    /** Days a chat survives before permanent deletion. */
    chatRetentionDays: number;
    /** Hard cap on stored memories. Mirrored by a DB trigger. */
    maxMemories: number;
    /** Hard cap on tracked interests. Mirrored by a DB trigger. */
    maxInterests: number;
    /** Chat turns per calendar day, in the user's own timezone. */
    chatMessagesPerDay: number;
    /** Daily-compass generations per day. Cached, so 1 is not restrictive. */
    compassPerDay: number;
    /** Whether interests and memories persist beyond a single chat. */
    longTermMemory: boolean;
    /** Advertising. Off everywhere at launch; the schema supports enabling it. */
    adsEnabled: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
    free: {
        chatRetentionDays: 7,
        maxMemories: 30,
        maxInterests: 5,
        chatMessagesPerDay: 20,
        compassPerDay: 3,
        longTermMemory: false,
        adsEnabled: false,
    },
    plus: {
        chatRetentionDays: 90,
        maxMemories: 100,
        maxInterests: 15,
        chatMessagesPerDay: 200,
        compassPerDay: 20,
        longTermMemory: true,
        adsEnabled: false,
    },
    pro: {
        chatRetentionDays: 365,
        maxMemories: 500,
        maxInterests: 30,
        chatMessagesPerDay: 1000,
        compassPerDay: 50,
        longTermMemory: true,
        adsEnabled: false,
    },
};

/** Access tokens are short so that revocation via refresh rotation is meaningful. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh tokens rotate on every use; this is the outer bound of a device session. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Grace period between a user requesting deletion and the data being purged. */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/**
 * Default calculation settings.
 *
 * These match the JHora conventions verified in node-jhora: True Chitrapaksha,
 * geometric positions, true node. They are copied onto each birth profile at
 * creation rather than read at calculation time, so that changing a server
 * default never moves an existing user's chart.
 */
export const DEFAULT_CHART_SETTINGS = {
    ayanamsa: 'true_chitra',
    nodeType: 'true',
    positionMode: 'geometric',
    houseSystem: 'whole_sign',
    dasamsaScheme: 'parashara',
    horaScheme: 'parashara',
} as const;
