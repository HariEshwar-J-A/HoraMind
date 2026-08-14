import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 *
 * The process refuses to boot on invalid configuration rather than failing at
 * the first request that happens to need a missing value. A server that starts
 * without a JWT secret and then throws on the first login is strictly worse
 * than one that never came up: the first looks healthy to a load balancer.
 *
 * Secrets have no defaults. A default secret is a secret that ships to
 * production.
 */

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSEY = new Set(['false', '0', 'no', 'off', '']);

/**
 * A boolean read from the environment.
 *
 * Not `z.coerce.boolean()`: that is `Boolean(value)`, which reads *any*
 * non-empty string as true — including the literal `"false"` that
 * `.env.example` documents and every deployment copies. The result is a value
 * that is silently the opposite of what the operator wrote, and it fails
 * somewhere far from the cause: `DATABASE_SSL=false` demands TLS of a database
 * that does not offer it, and `TRUST_PROXY=false` makes every client IP read as
 * the proxy's, so all users share a single rate-limit bucket.
 *
 * Unrecognised spellings are rejected rather than defaulted. A typo'd
 * `DATABASE_SSL=ture` that quietly disables TLS in production is precisely the
 * class of failure this file exists to prevent.
 */
function envBoolean(defaultValue: boolean) {
    return z
        .union([z.boolean(), z.string()])
        .default(defaultValue)
        .transform((value, ctx) => {
            if (typeof value === 'boolean') return value;

            const normalised = value.trim().toLowerCase();
            if (TRUTHY.has(normalised)) return true;
            if (FALSEY.has(normalised)) return false;

            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `expected one of true/false/1/0/yes/no/on/off, received "${value}"`,
            });
            return z.NEVER;
        });
}

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT:     z.coerce.number().int().min(1).max(65535).default(8080),
    HOST:     z.string().default('0.0.0.0'),
    // 'silent' is a real pino level and the only sane setting for test runs.
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    /** Behind Caddy/ingress this must be true or every client IP reads as the proxy. */
    TRUST_PROXY: envBoolean(false),

    /** Comma-separated origins, or "*" in development. */
    CORS_ORIGIN: z.string().default('*'),

    DATABASE_URL: z.string().url().describe('postgres://user:pass@host:5432/horamind'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: envBoolean(false),

    /**
     * Signing key for access tokens. Minimum 32 bytes of entropy;
     * generate with `openssl rand -base64 48`.
     */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ISSUER:   z.string().default('horamind'),
    JWT_AUDIENCE: z.string().default('horamind-app'),

    /** OAuth client ids, used to verify the `aud` claim of incoming ID tokens. */
    GOOGLE_CLIENT_ID_IOS:     z.string().optional(),
    GOOGLE_CLIENT_ID_ANDROID: z.string().optional(),
    GOOGLE_CLIENT_ID_WEB:     z.string().optional(),
    APPLE_BUNDLE_ID:          z.string().optional(),
    APPLE_SERVICE_ID:         z.string().optional(),

    /** ChromaDB, serving the JyotishBase corpus. */
    CHROMA_URL:        z.string().url().default('http://localhost:8000'),
    CHROMA_COLLECTION: z.string().default('santhanam_source_of_truth'),

    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    /**
     * `meta-llama/llama-3.3-70b-instruct:free` was retired. The paid twin still
     * returns hollow 200s when OpenRouter routes it to DeepInfra. Gemini Flash
     * is single-provider, so it cannot hit that raffle.
     */
    OPENROUTER_MODEL_FREE: z.string().default('google/gemini-2.5-flash'),
    OPENROUTER_MODEL_PAID: z.string().default('anthropic/claude-sonnet-4.5'),

    /**
     * Web Push. All three must be set together or push is simply not offered;
     * in-app notifications still work. Generate with `npx web-push generate-vapid-keys`.
     */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),

    /** Public base URL, used for OAuth redirects and links in transactional email. */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),

    /** Path to the DE440s ephemeris; node-jhora resolves its own default if unset. */
    NODE_JHORA_EPHE_PATH: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Parse and cache the environment.
 *
 * Errors are reported all at once with the offending keys named, because
 * fixing configuration one restart at a time is miserable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
    if (cached) return cached;

    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map(i => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }

    cached = parsed.data;
    return cached;
}

/** Test helper: forget the cached parse so a fresh environment can be loaded. */
export function resetEnv(): void {
    cached = null;
}

export function corsOrigins(env: Env): true | string[] {
    if (env.CORS_ORIGIN === '*') return true;
    return env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
}
