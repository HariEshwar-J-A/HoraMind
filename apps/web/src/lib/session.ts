import { create } from 'zustand';
import type { PublicUser, BirthProfile } from '@horamind/shared';
import { api, ApiError } from './api.js';
import { tokenStore } from './tokenStore.js';

/**
 * Session state.
 *
 * Zustand rather than Context: it runs identically on React Native, has no
 * provider to thread through the tree, and lets non-component code — the API
 * client's sign-out callback, for instance — read and write the same store.
 */

interface SessionState {
    user: PublicUser | null;
    profile: BirthProfile | null;
    /** Distinguishes "not signed in" from "we have not checked yet". */
    status: 'unknown' | 'authenticated' | 'anonymous';

    signIn(email: string, password: string): Promise<void>;
    register(email: string, password: string, timezone: string): Promise<void>;
    signOut(): Promise<void>;
    /** Restores a session from the refresh cookie on app start. */
    restore(): Promise<void>;
    loadProfile(): Promise<void>;
    setProfile(profile: BirthProfile): void;
}

interface AuthResponse {
    user: PublicUser;
    tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

/** The browser's own zone, so the server's day boundary matches the user's. */
function currentTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function device() {
    return { label: 'Web browser', platform: 'web' as const };
}

export const useSession = create<SessionState>((set, get) => ({
    user: null,
    profile: null,
    status: 'unknown',

    async signIn(email, password) {
        const res = await api.post<AuthResponse>(
            '/v1/auth/login', { email, password, device: device() }, { skipAuth: true },
        );
        tokenStore.setAccessToken(res.tokens.accessToken, res.tokens.expiresIn);
        set({ user: res.user, status: 'authenticated' });
        await get().loadProfile();
    },

    async register(email, password, timezone) {
        const res = await api.post<AuthResponse>('/v1/auth/register', {
            email, password, timezone, device: device(), acceptedTerms: true,
        }, { skipAuth: true });
        tokenStore.setAccessToken(res.tokens.accessToken, res.tokens.expiresIn);
        set({ user: res.user, status: 'authenticated' });
    },

    async signOut() {
        // Best-effort: if the call fails the local session is cleared anyway.
        // A user who taps sign out and stays signed in has been ignored.
        await api.post('/v1/auth/logout').catch(() => undefined);
        await tokenStore.clear();
        set({ user: null, profile: null, status: 'anonymous' });
    },

    async restore() {
        try {
            // No access token in memory after a reload — this succeeds only if
            // the httpOnly refresh cookie is still valid, which is exactly the
            // question being asked.
            const user = await api.get<PublicUser>('/v1/auth/me');
            set({ user, status: 'authenticated' });
            await get().loadProfile();
        } catch {
            set({ user: null, profile: null, status: 'anonymous' });
        }
    },

    async loadProfile() {
        try {
            const res = await api.get<{ profiles: BirthProfile[] }>('/v1/profiles');
            set({ profile: res.profiles.find(p => p.isPrimary) ?? res.profiles[0] ?? null });
        } catch (err) {
            // A missing profile is the normal state before onboarding, not a
            // failure worth surfacing.
            if (!(err instanceof ApiError && err.status === 404)) throw err;
            set({ profile: null });
        }
    },

    setProfile(profile) {
        set({ profile });
    },
}));

/*
 * A failed refresh means the session is gone — revoked from another device, or
 * simply expired. Without this the store keeps reporting `authenticated`, the
 * route guard keeps letting screens render, and every request fails with no
 * path back to sign-in. Registered here rather than injected at construction
 * because the client cannot import this module without a cycle.
 */
api.setSignedOutHandler(() => {
    useSession.setState({ user: null, profile: null, status: 'anonymous' });
});

export { currentTimezone };
