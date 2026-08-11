/**
 * Token storage, behind an interface.
 *
 * The access token lives in memory only and is deliberately never persisted:
 * anything reachable from JavaScript is reachable by injected JavaScript, and a
 * 15-minute token that dies with the tab is a far smaller prize than one
 * sitting in `localStorage`.
 *
 * The refresh token is the sensitive one, and where it lives is the only part
 * of this that differs by platform:
 *
 *   Web    an httpOnly, SameSite=Strict cookie set by the API. Unreadable from
 *          JavaScript by construction, which is why the API and the client are
 *          served from one origin — a separate api. subdomain would forfeit it.
 *   Native expo-secure-store, backed by Keychain or Keystore.
 *
 * Every screen talks to this interface, so the native port implements one class
 * and changes nothing else.
 */

export interface TokenStore {
    getAccessToken(): string | null;
    setAccessToken(token: string | null, expiresInSeconds?: number): void;
    /** Null on web: the browser holds it in a cookie we cannot read. */
    getRefreshToken(): Promise<string | null>;
    setRefreshToken(token: string | null): Promise<void>;
    clear(): Promise<void>;
    /** True when the access token is absent or within the refresh margin. */
    needsRefresh(): boolean;
}

/**
 * Refresh this long before expiry.
 *
 * Waiting for an actual 401 costs a failed request and a retry on every
 * screen; refreshing 60 seconds early costs nothing and hides the seam.
 */
const REFRESH_MARGIN_MS = 60_000;

export class WebTokenStore implements TokenStore {
    private accessToken: string | null = null;
    private expiresAt = 0;

    getAccessToken(): string | null {
        return this.accessToken;
    }

    setAccessToken(token: string | null, expiresInSeconds = 900): void {
        this.accessToken = token;
        this.expiresAt = token ? Date.now() + expiresInSeconds * 1000 : 0;
    }

    /**
     * Always null on web.
     *
     * The refresh token is in an httpOnly cookie the browser attaches
     * automatically. Being unable to read it is the security property, not a
     * limitation to work around.
     */
    async getRefreshToken(): Promise<string | null> {
        return null;
    }

    async setRefreshToken(): Promise<void> {
        // No-op: the API sets the cookie via Set-Cookie.
    }

    async clear(): Promise<void> {
        this.accessToken = null;
        this.expiresAt = 0;
    }

    needsRefresh(): boolean {
        if (!this.accessToken) return true;
        return Date.now() >= this.expiresAt - REFRESH_MARGIN_MS;
    }
}

/**
 * Sketch of the native implementation, for reference.
 *
 * Not exported and not built — it documents the contract the port has to meet
 * so the shape is not rediscovered later:
 *
 *   class NativeTokenStore implements TokenStore {
 *       async getRefreshToken() {
 *           return SecureStore.getItemAsync('horamind.refresh');
 *       }
 *       async setRefreshToken(token: string | null) {
 *           token ? await SecureStore.setItemAsync('horamind.refresh', token)
 *                 : await SecureStore.deleteItemAsync('horamind.refresh');
 *       }
 *   }
 *
 * The only behavioural difference is that native sends the refresh token in the
 * request body, since there is no cookie jar to carry it.
 */

export const tokenStore: TokenStore = new WebTokenStore();
