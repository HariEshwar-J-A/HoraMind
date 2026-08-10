import { z } from 'zod';
import { EmailSchema, PasswordSchema, PublicIdSchema, IanaTimezoneSchema, UuidSchema } from './common.js';
import { TIERS } from '../constants.js';

/**
 * Authentication contracts.
 *
 * Three sign-in methods at launch: email/password, Google, and Apple.
 *
 * Sign in with Apple is not optional. App Store Review Guideline 4.8 requires
 * it in any app that offers another third-party login, so shipping Google
 * without it is a rejection. `github` exists in the provider enum so it can be
 * enabled later without a migration, but it is not offered at launch — it is a
 * developer credential and the audience is not developers.
 */

export const AUTH_PROVIDERS = ['password', 'google', 'apple', 'github'] as const;
export const AuthProviderSchema = z.enum(AUTH_PROVIDERS);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

/**
 * Sent with every credential exchange so the resulting session is
 * recognisable in the device list. Supplied by the client, therefore
 * untrusted: it is displayed, never used for authorisation.
 */
export const DeviceInfoSchema = z.object({
    label:      z.string().min(1).max(80).default('Unknown device'),
    platform:   z.enum(['ios', 'android', 'web', 'unknown']).default('unknown'),
    appVersion: z.string().max(32).optional(),
});

export const RegisterSchema = z.object({
    email:       EmailSchema,
    password:    PasswordSchema,
    displayName: z.string().min(1).max(80).optional(),
    timezone:    IanaTimezoneSchema.default('UTC'),
    device:      DeviceInfoSchema.default({ label: 'Unknown device', platform: 'unknown' }),
    /**
     * Explicit consent, recorded at signup. Both stores require a privacy
     * policy, and consent that was never affirmatively given is not consent.
     */
    acceptedTerms: z.literal(true, {
        errorMap: () => ({ message: 'Terms and privacy policy must be accepted' }),
    }),
});

export const LoginSchema = z.object({
    email:    EmailSchema,
    password: z.string().min(1).max(200),
    device:   DeviceInfoSchema.default({ label: 'Unknown device', platform: 'unknown' }),
});

/**
 * Google and Apple both hand the client an ID token, which the server verifies
 * against the provider's JWKS. The server never sees the user's password with
 * these providers and never asks for one.
 */
export const OAuthLoginSchema = z.object({
    provider: z.enum(['google', 'apple']),
    idToken:  z.string().min(16),
    /**
     * Apple returns the user's name exactly once, on first authorisation, and
     * never again. If the client does not forward it here it is lost forever.
     */
    fullName: z.string().max(120).optional(),
    device:   DeviceInfoSchema.default({ label: 'Unknown device', platform: 'unknown' }),
});

export const RefreshSchema = z.object({
    refreshToken: z.string().min(16),
});

export const TokenPairSchema = z.object({
    accessToken:  z.string(),
    refreshToken: z.string(),
    /** Seconds until the access token expires, so clients can refresh ahead of failure. */
    expiresIn:    z.number().int().positive(),
    tokenType:    z.literal('Bearer'),
});

export const PublicUserSchema = z.object({
    publicId:      PublicIdSchema,
    email:         z.string().email(),
    emailVerified: z.boolean(),
    displayName:   z.string().nullable(),
    tier:          z.enum(TIERS),
    timezone:      z.string(),
    createdAt:     z.string(),
    /** Which sign-in methods are linked; the UI must not offer to unlink the last one. */
    linkedProviders: z.array(AuthProviderSchema),
});

export const SessionSummarySchema = z.object({
    id:         UuidSchema,
    label:      z.string().nullable(),
    platform:   z.string().nullable(),
    appVersion: z.string().nullable(),
    createdAt:  z.string(),
    lastSeenAt: z.string(),
    /** Marks the session making the request, so the UI can label it "This device". */
    current:    z.boolean(),
});

/** Omitting `sessionId` revokes every device, including the caller's. */
export const RevokeSessionsSchema = z.object({
    sessionId: UuidSchema.optional(),
    all:       z.boolean().default(false),
});

export const RequestPasswordResetSchema = z.object({ email: EmailSchema });

export const ConfirmPasswordResetSchema = z.object({
    token:       z.string().min(16),
    newPassword: PasswordSchema,
});

/**
 * Deleting an account is irreversible after the grace period, so it requires
 * re-authentication — a stolen access token should not be able to destroy an
 * account. OAuth-only users have no password and confirm with a fresh ID token.
 */
export const DeleteAccountSchema = z.object({
    password: z.string().min(1).optional(),
    idToken:  z.string().min(16).optional(),
    confirm:  z.literal('DELETE'),
});

export type Register            = z.infer<typeof RegisterSchema>;
export type Login               = z.infer<typeof LoginSchema>;
export type OAuthLogin          = z.infer<typeof OAuthLoginSchema>;
export type TokenPair           = z.infer<typeof TokenPairSchema>;
export type PublicUser          = z.infer<typeof PublicUserSchema>;
export type SessionSummary      = z.infer<typeof SessionSummarySchema>;
export type DeviceInfo          = z.infer<typeof DeviceInfoSchema>;
