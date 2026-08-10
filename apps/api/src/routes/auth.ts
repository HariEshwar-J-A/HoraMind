import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
    RegisterSchema, LoginSchema, OAuthLoginSchema, RefreshSchema,
    TokenPairSchema, PublicUserSchema, DeleteAccountSchema,
    RequestPasswordResetSchema, ConfirmPasswordResetSchema,
} from '@horamind/shared';

import { getDb } from '../db/client.js';
import { loadEnv } from '../config/env.js';
import * as auth from '../services/auth.js';
import * as users from '../repos/users.js';
import { hashPassword, hashToken, generateOpaqueToken } from '../lib/crypto.js';
import { revokeAllSessions } from '../repos/sessions.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Authentication routes.
 *
 * Sign-in methods at launch are email/password, Google and Apple. Sign in with
 * Apple is not a preference: App Store Review Guideline 4.8 requires it in any
 * app that offers another third-party login, so shipping Google without it is a
 * rejection.
 */

const AuthResultSchema = z.object({
    user: PublicUserSchema,
    tokens: TokenPairSchema,
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const env = loadEnv();

    typed.post('/auth/register', {
        schema: {
            tags: ['auth'],
            description: 'Create an account with email and password.',
            body: RegisterSchema,
            response: { 201: AuthResultSchema },
        },
    }, async (req, reply) => {
        const b = req.body;
        const result = await auth.register(
            getDb(), env,
            { email: b.email, password: b.password, displayName: b.displayName, timezone: b.timezone },
            b.device, req.ip,
        );
        return reply.status(201).send(result);
    });

    typed.post('/auth/login', {
        schema: {
            tags: ['auth'],
            description: 'Sign in with email and password.',
            body: LoginSchema,
            response: { 200: AuthResultSchema },
        },
    }, async (req, reply) => {
        const b = req.body;
        const result = await auth.login(getDb(), env, { email: b.email, password: b.password }, b.device, req.ip);
        return reply.status(200).send(result);
    });

    typed.post('/auth/oauth', {
        schema: {
            tags: ['auth'],
            description: 'Sign in with Google or Apple using a provider ID token.',
            body: OAuthLoginSchema,
            response: { 200: AuthResultSchema.extend({ created: z.boolean() }) },
        },
    }, async (req, reply) => {
        const b = req.body;
        const result = await auth.oauthLogin(
            getDb(), env,
            { provider: b.provider, idToken: b.idToken, fullName: b.fullName },
            b.device, req.ip,
        );
        return reply.status(200).send(result);
    });

    typed.post('/auth/refresh', {
        schema: {
            tags: ['auth'],
            description: 'Exchange a refresh token for a new pair. The old token is invalidated.',
            body: RefreshSchema,
            response: { 200: TokenPairSchema },
        },
    }, async (req, reply) => {
        const tokens = await auth.refresh(getDb(), env, req.body.refreshToken);
        return reply.status(200).send(tokens);
    });

    typed.post('/auth/logout', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['auth'],
            description: 'Revoke the session this token belongs to.',
            security: [{ bearerAuth: [] }],
            response: { 204: z.null() },
        },
    }, async (req, reply) => {
        await auth.logout(getDb(), req.user!.id, req.user!.sessionId);
        return reply.status(204).send(null);
    });

    typed.get('/auth/me', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['auth'],
            description: 'The signed-in user.',
            security: [{ bearerAuth: [] }],
            response: { 200: PublicUserSchema },
        },
    }, async (req, reply) => {
        const user = await users.findUserById(getDb(), req.user!.id);
        // A live session whose user is gone means the account was deleted
        // mid-session; surface it as an auth failure so the client signs out.
        if (!user) throw notFound('User');
        return reply.status(200).send(await auth.toPublicUser(getDb(), user));
    });

    // -----------------------------------------------------------------------
    // Password reset
    // -----------------------------------------------------------------------

    typed.post('/auth/password/reset-request', {
        schema: {
            tags: ['auth'],
            description: 'Request a password reset email.',
            body: RequestPasswordResetSchema,
            response: { 202: z.object({ status: z.literal('accepted') }) },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const user = await users.findUserByEmail(sql, req.body.email);

        // Always 202, whether or not the address exists. Anything else turns
        // this endpoint into an account-existence oracle that needs no
        // credentials at all.
        if (user) {
            const token = generateOpaqueToken();
            await sql`
                INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
                VALUES (${user.id}, 'password_reset', ${hashToken(token)}, now() + interval '1 hour')`;
            // TODO(Epic 5): hand `token` to the transactional email provider.
            // Until one is configured the token is generated and stored but
            // never delivered, so the flow is inert rather than insecure.
            req.log.info({ userId: user.id }, 'password reset token issued');
        }

        return reply.status(202).send({ status: 'accepted' });
    });

    typed.post('/auth/password/reset-confirm', {
        schema: {
            tags: ['auth'],
            description: 'Set a new password using a reset token.',
            body: ConfirmPasswordResetSchema,
            response: { 204: z.null() },
        },
    }, async (req, reply) => {
        const sql = getDb();
        const digest = hashToken(req.body.token);

        const [row] = await sql<{ id: string; userId: string }[]>`
            SELECT id, user_id FROM auth_tokens
             WHERE token_hash = ${digest}
               AND purpose = 'password_reset'
               AND consumed_at IS NULL
               AND expires_at > now()`;

        if (!row) throw badRequest('This reset link is invalid or has expired');

        await sql.begin(async tx => {
            await tx`UPDATE auth_tokens SET consumed_at = now() WHERE id = ${row.id}`;
            await tx`UPDATE users SET password_hash = ${await hashPassword(req.body.newPassword)},
                                      updated_at = now()
                      WHERE id = ${row.userId}`;
        });

        // A password reset usually means the account was at risk. Every other
        // device is signed out, because leaving a compromised session alive
        // makes the reset pointless.
        await revokeAllSessions(sql, row.userId);

        return reply.status(204).send(null);
    });

    // -----------------------------------------------------------------------
    // Account deletion
    // -----------------------------------------------------------------------

    typed.post('/auth/delete-account', {
        onRequest: [app.authenticate],
        schema: {
            tags: ['auth'],
            description:
                'Delete the account. Soft-deleted immediately and purged after the grace period. '
                + 'Required in-app by App Store Guideline 5.1.1(v).',
            security: [{ bearerAuth: [] }],
            body: DeleteAccountSchema,
            response: { 202: z.object({ status: z.literal('scheduled'), purgeAfterDays: z.number() }) },
        },
    }, async (req, reply) => {
        await auth.deleteAccount(getDb(), env, req.user!.id, {
            password: req.body.password,
            idToken: req.body.idToken,
        });
        return reply.status(202).send({ status: 'scheduled', purgeAfterDays: 30 });
    });
}
