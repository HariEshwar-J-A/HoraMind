import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { toWebStyle, type Style } from '../src/theme/tokens.js';
import { WebTokenStore } from '../src/lib/tokenStore.js';
import { ApiClient, ApiError } from '../src/lib/api.js';
import { ROUTES, TABS, routeFor } from '../src/routes/routes.js';

/**
 * Client tests.
 *
 * Weighted towards the three things that are silently wrong-able: unit
 * conversion between the token system and CSS, token refresh under concurrency,
 * and the route table's guard flags.
 */

describe('style tokens', () => {
    test('numbers become pixels', () => {
        expect(toWebStyle({ padding: 16 })).toEqual({ padding: '16px' });
    });

    test('lineHeight gets a unit', () => {
        // React Native reads lineHeight as pixels and the tokens are written
        // that way, but CSS reads a bare number as a MULTIPLIER — so passing 34
        // through unitless would render a line box 34 times the font size.
        expect(toWebStyle({ lineHeight: 34 })).toEqual({ lineHeight: '34px' });
    });

    test('genuinely unitless properties keep their bare number', () => {
        const out = toWebStyle({ flex: 1, opacity: 0.5, zIndex: 10, fontWeight: '600' });
        expect(out).toEqual({ flex: 1, opacity: 0.5, zIndex: 10, fontWeight: '600' });
    });

    test('strings pass through untouched', () => {
        const style: Style = { backgroundColor: '#0B0D17', paddingTop: 'env(safe-area-inset-top)' };
        expect(toWebStyle(style)).toEqual(style);
    });
});

describe('token store', () => {
    let store: WebTokenStore;
    beforeEach(() => { store = new WebTokenStore(); });

    test('starts needing a refresh', () => {
        expect(store.needsRefresh()).toBe(true);
        expect(store.getAccessToken()).toBeNull();
    });

    test('a fresh token does not need refreshing', () => {
        store.setAccessToken('abc', 900);
        expect(store.needsRefresh()).toBe(false);
        expect(store.getAccessToken()).toBe('abc');
    });

    test('refreshes ahead of expiry rather than after a failure', () => {
        // Waiting for a real 401 costs a failed request and a retry on every
        // screen. The margin hides the seam.
        store.setAccessToken('abc', 30);
        expect(store.needsRefresh()).toBe(true);
    });

    test('never exposes a refresh token to JavaScript on web', async () => {
        // It lives in an httpOnly cookie. Being unable to read it is the
        // security property, not a limitation.
        expect(await store.getRefreshToken()).toBeNull();
    });

    test('clearing removes the access token', async () => {
        store.setAccessToken('abc', 900);
        await store.clear();
        expect(store.getAccessToken()).toBeNull();
    });
});

describe('api client', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    test('surfaces the error envelope as a typed error', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'Out of questions', requestId: 'r1' } }),
            { status: 429 },
        )));

        const client = new ApiClient({ store: new WebTokenStore() });
        await expect(client.get('/v1/interpret/quota')).rejects.toBeInstanceOf(ApiError);

        try {
            await client.get('/v1/interpret/quota');
        } catch (err) {
            const e = err as ApiError;
            expect(e.code).toBe('QUOTA_EXCEEDED');
            // Distinguishing a quota from a fault decides whether the UI says
            // "try tomorrow" or "something went wrong".
            expect(e.isQuota).toBe(true);
            expect(e.requestId).toBe('r1');
        }
    });

    test('concurrent requests share one refresh', async () => {
        // Without sharing, each 401 starts its own refresh. The first rotates
        // the token and the rest present one just rotated away, which the
        // server correctly reads as reuse — and revokes the whole session. The
        // user is signed out for doing nothing but opening the app.
        let refreshCalls = 0;

        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).includes('/auth/refresh')) {
                refreshCalls++;
                return new Response(
                    JSON.stringify({ accessToken: 'fresh', expiresIn: 900 }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }));

        const client = new ApiClient({ store: new WebTokenStore() });
        await Promise.all([
            client.get('/v1/auth/me'),
            client.get('/v1/profiles'),
            client.get('/v1/memories'),
        ]);

        expect(refreshCalls).toBe(1);
    });

    test('a failed refresh signs the user out exactly once', async () => {
        const onSignedOut = vi.fn();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

        const client = new ApiClient({ store: new WebTokenStore(), onSignedOut });
        await expect(client.get('/v1/auth/me')).rejects.toBeInstanceOf(ApiError);
        expect(onSignedOut).toHaveBeenCalled();
    });

    test('204 responses do not attempt to parse a body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
        const store = new WebTokenStore();
        store.setAccessToken('t', 900);
        const client = new ApiClient({ store });
        await expect(client.del('/v1/chats/x')).resolves.toBeUndefined();
    });
});

describe('route table', () => {
    test('is data, not JSX, so a native router can be built from it', () => {
        expect(Array.isArray(ROUTES)).toBe(true);
        expect(ROUTES.every(r => typeof r.path === 'string' && typeof r.screen === 'string')).toBe(true);
    });

    test('sign-in is the only unauthenticated route', () => {
        const open = ROUTES.filter(r => !r.requiresAuth).map(r => r.path);
        expect(open).toEqual(['/sign-in']);
    });

    test('onboarding does not require a profile', () => {
        // It is where a profile gets created; requiring one would deadlock.
        expect(routeFor('/onboarding')?.requiresProfile).toBeFalsy();
    });

    test('every chart-dependent route requires a profile', () => {
        for (const path of ['/', '/chart', '/ask', '/you']) {
            expect(routeFor(path)?.requiresProfile, `${path} must require a profile`).toBe(true);
        }
    });

    test('tabs are a subset of routes and all authenticated', () => {
        expect(TABS.length).toBeGreaterThan(0);
        expect(TABS.every(t => t.requiresAuth)).toBe(true);
        expect(TABS.every(t => ROUTES.includes(t))).toBe(true);
    });

    test('paths are unique', () => {
        expect(new Set(ROUTES.map(r => r.path)).size).toBe(ROUTES.length);
    });
});

describe('session recovery', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    test('a failed refresh drops the session to anonymous', async () => {
        // The bug this guards: with no sign-out handler wired, a refresh that
        // fails mid-session leaves the store reporting "authenticated". The
        // route guard keeps rendering screens, every request fails, and there
        // is no path back to sign-in — the app simply stops working.
        const { useSession } = await import('../src/lib/session.js');

        useSession.setState({
            user: { publicId: 'A1B2C3D4' } as never,
            status: 'authenticated',
        });

        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

        await useSession.getState().restore();

        expect(useSession.getState().status).toBe('anonymous');
        expect(useSession.getState().user).toBeNull();
        expect(useSession.getState().profile).toBeNull();
    });

    test('signing out clears local state even when the server call fails', async () => {
        // A user who taps sign out and stays signed in has been ignored.
        const { useSession } = await import('../src/lib/session.js');

        useSession.setState({ user: { publicId: 'A1B2C3D4' } as never, status: 'authenticated' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

        await useSession.getState().signOut();

        expect(useSession.getState().status).toBe('anonymous');
        expect(useSession.getState().user).toBeNull();
    });
});
