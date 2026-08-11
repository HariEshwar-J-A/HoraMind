import type { TokenStore } from './tokenStore.js';
import { tokenStore as defaultStore } from './tokenStore.js';

/**
 * API client.
 *
 * `fetch` only — no axios, no XMLHttpRequest, nothing DOM-specific. React
 * Native ships `fetch`, so this file moves to a native app unchanged.
 *
 * It owns one piece of behaviour worth centralising: transparent token refresh.
 * Without it, every screen would have to notice a 401, refresh, and retry, and
 * one screen would eventually forget.
 */

export interface ApiErrorBody {
    error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details?: unknown,
        readonly requestId?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }

    /** Quota and product limits are worth distinguishing in the UI from real faults. */
    get isQuota(): boolean {
        return this.code === 'QUOTA_EXCEEDED' || this.code === 'LIMIT_REACHED';
    }

    get isAuth(): boolean {
        return this.status === 401;
    }
}

export interface ApiClientOptions {
    baseUrl?: string;
    store?: TokenStore;
    /** Called when refresh fails and the user must sign in again. */
    onSignedOut?: () => void;
}

export class ApiClient {
    private readonly baseUrl: string;
    private readonly store: TokenStore;
    private readonly onSignedOut?: () => void;

    /**
     * A single in-flight refresh, shared.
     *
     * Screens fire several requests at once on load. Without this, each 401
     * starts its own refresh; the first rotates the token and the rest present
     * one that has just been rotated away — which the server correctly reads as
     * token reuse and responds to by revoking the entire session. The user is
     * silently logged out for doing nothing but opening the app.
     */
    private refreshing: Promise<boolean> | null = null;

    constructor(opts: ApiClientOptions = {}) {
        this.baseUrl = opts.baseUrl ?? '/api';
        this.store = opts.store ?? defaultStore;
        this.onSignedOut = opts.onSignedOut;
    }

    async request<T>(
        path: string,
        init: RequestInit & { skipAuth?: boolean } = {},
    ): Promise<T> {
        const { skipAuth, ...rest } = init;

        if (!skipAuth && this.store.needsRefresh()) {
            await this.refresh();
        }

        let res = await this.send(path, rest, skipAuth);

        // A 401 despite a fresh-looking token means it was revoked server-side —
        // another device signed this one out. One retry, then give up.
        if (res.status === 401 && !skipAuth) {
            if (await this.refresh()) {
                res = await this.send(path, rest, skipAuth);
            }
        }

        return this.parse<T>(res);
    }

    private async send(path: string, init: RequestInit, skipAuth?: boolean): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set('Content-Type', 'application/json');

        const token = this.store.getAccessToken();
        if (!skipAuth && token) headers.set('Authorization', `Bearer ${token}`);

        return fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers,
            // Carries the httpOnly refresh cookie on web. Harmless on native,
            // where there is no cookie jar.
            credentials: 'include',
        });
    }

    private async refresh(): Promise<boolean> {
        // Join the in-flight attempt rather than starting a second one.
        if (this.refreshing) return this.refreshing;

        this.refreshing = (async () => {
            try {
                const stored = await this.store.getRefreshToken();
                const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    // Web sends nothing — the cookie carries it. Native sends
                    // the token it holds in secure storage.
                    body: JSON.stringify(stored ? { refreshToken: stored } : {}),
                });

                if (!res.ok) {
                    await this.store.clear();
                    this.onSignedOut?.();
                    return false;
                }

                const body = await res.json() as { accessToken: string; refreshToken?: string; expiresIn: number };
                this.store.setAccessToken(body.accessToken, body.expiresIn);
                if (body.refreshToken) await this.store.setRefreshToken(body.refreshToken);
                return true;
            } catch {
                await this.store.clear();
                this.onSignedOut?.();
                return false;
            } finally {
                this.refreshing = null;
            }
        })();

        return this.refreshing;
    }

    private async parse<T>(res: Response): Promise<T> {
        if (res.status === 204) return undefined as T;

        const text = await res.text();
        const body = text ? JSON.parse(text) as unknown : null;

        if (!res.ok) {
            const err = (body as ApiErrorBody | null)?.error;
            throw new ApiError(
                res.status,
                err?.code ?? 'UNKNOWN',
                err?.message ?? `Request failed with ${res.status}`,
                err?.details,
                err?.requestId,
            );
        }

        return body as T;
    }

    get<T>(path: string): Promise<T> {
        return this.request<T>(path, { method: 'GET' });
    }

    post<T>(path: string, body?: unknown, opts: { skipAuth?: boolean } = {}): Promise<T> {
        return this.request<T>(path, {
            method: 'POST',
            body: body === undefined ? undefined : JSON.stringify(body),
            ...opts,
        });
    }

    patch<T>(path: string, body: unknown): Promise<T> {
        return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
    }

    del<T>(path: string): Promise<T> {
        return this.request<T>(path, { method: 'DELETE' });
    }
}

export const api = new ApiClient();
