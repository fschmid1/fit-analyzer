/**
 * Shared OAuth2 authorization-code flow for Strava and Wahoo.
 *
 * Both providers implement the same flow shape — build an authorize URL,
 * exchange a code for tokens, refresh expired tokens, deauthorize — but
 * each route previously inlined its own copy. This module owns the shared
 * orchestration; provider adapters supply the URLs, param shapes, and
 * response parsing that differ between Strava and Wahoo.
 *
 * Two adapters justify the seam: a real HTTP provider in production and a
 * fake in tests (see oauth2.test.ts).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Normalized token as persisted in the provider's token table. */
export interface StoredToken {
	userId: string;
	accessToken: string;
	refreshToken: string;
	/** Absolute unix-seconds expiry of the access token. */
	expiresAt: number;
	/** Provider-side user id (Strava athlete id / Wahoo user id). */
	providerUserId: number | null;
	scope: string;
}

/** Token fields returned by exchange/refresh, before persistence. */
export interface ParsedToken {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	providerUserId?: number | null;
	scope?: string;
}

/**
 * HTTP adapter — everything that differs between Strava and Wahoo.
 * The flow calls these to build URLs/params and parse provider responses.
 */
export interface OAuth2Provider {
	name: string;
	authorizeUrl: string;
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	/** Pre-formatted scope string (comma-separated for Strava, space for Wahoo). */
	scope: string;
	/** Extra params for the authorize URL (e.g. Strava's approval_prompt). */
	extraAuthorizeParams?: Record<string, string>;
	/** Extra params for the code-for-token exchange (e.g. Wahoo's redirect_uri). */
	extraExchangeParams?: Record<string, string>;
	/** Parse a token response body (exchange or refresh) into normalized fields. */
	parseTokenResponse(body: unknown): ParsedToken;
	/** Fetch the provider-side user id after exchange, if not in the token response. */
	fetchProviderUserId?(accessToken: string): Promise<number | null>;
	/** Deauthorize the app at the provider (optional — Strava has none). */
	deauthorize?(accessToken: string): Promise<void>;
}

/**
 * Persistence adapter — get/upsert/update/delete tokens in the provider's
 * token table. Each provider has its own table (strava_tokens / wahoo_tokens)
 * with provider-specific columns, so each gets a concrete store.
 */
export interface OAuth2TokenStore {
	get(userId: string): StoredToken | null;
	getByProviderUserId(providerUserId: number): StoredToken | null;
	upsert(token: StoredToken): void;
	updateTokens(
		userId: string,
		accessToken: string,
		refreshToken: string,
		expiresAt: number,
	): void;
	delete(userId: string): void;
}

// ─── Flow ─────────────────────────────────────────────────────────────────────

/** Refresh this early to avoid racing the provider's expiry. */
const REFRESH_MARGIN_SEC = 60;

export class OAuth2Flow {
	constructor(
		private readonly provider: OAuth2Provider,
		private readonly tokenStore: OAuth2TokenStore,
	) {}

	/** Build the full authorize URL with the given CSRF state. */
	buildAuthorizeUrl(state: string): string {
		const params = new URLSearchParams({
			client_id: this.provider.clientId,
			redirect_uri: this.provider.redirectUri,
			response_type: "code",
			scope: this.provider.scope,
			state,
			...this.provider.extraAuthorizeParams,
		});
		return `${this.provider.authorizeUrl}?${params.toString()}`;
	}

	/** The provider name (used as the CSRF state scope). */
	get providerName(): string {
		return this.provider.name;
	}

	/**
	 * Exchange an authorization code for tokens. Fetches the provider user id
	 * if the token response doesn't include it. Does NOT persist — the caller
	 * upserts with the resolved userId.
	 */
	async exchangeCode(code: string): Promise<ParsedToken> {
		const params: Record<string, string> = {
			client_id: this.provider.clientId,
			client_secret: this.provider.clientSecret,
			code,
			grant_type: "authorization_code",
			...this.provider.extraExchangeParams,
		};

		const res = await this.postToken(params, "exchange");
		const parsed = this.provider.parseTokenResponse(await res.json());

		if (parsed.providerUserId == null && this.provider.fetchProviderUserId) {
			parsed.providerUserId = await this.provider.fetchProviderUserId(
				parsed.accessToken,
			);
		}
		return parsed;
	}

	/**
	 * Refresh an expired token. Returns the new token fields; the caller is
	 * responsible for persisting them (getValidToken does this automatically).
	 */
	async refreshToken(token: StoredToken): Promise<ParsedToken> {
		const params: Record<string, string> = {
			client_id: this.provider.clientId,
			client_secret: this.provider.clientSecret,
			grant_type: "refresh_token",
			refresh_token: token.refreshToken,
		};

		const res = await this.postToken(params, "refresh");
		return this.provider.parseTokenResponse(await res.json());
	}

	/**
	 * Return a valid access token for `userId`, refreshing if within
	 * REFRESH_MARGIN_SEC of expiry. Throws if the user has no token.
	 */
	async getValidToken(userId: string): Promise<string> {
		const token = this.tokenStore.get(userId);
		if (!token)
			throw new Error(
				`${this.provider.name[0].toUpperCase()}${this.provider.name.slice(1)} not connected for this user`,
			);

		if (Math.floor(Date.now() / 1000) >= token.expiresAt - REFRESH_MARGIN_SEC) {
			console.log(
				`[${this.provider.name}] Starting token refresh for user ${userId}`,
			);
			const refreshed = await this.refreshToken(token);
			// Providers (Google especially) only return a refresh token on the
			// first consent; a refresh response usually omits it. Keep the
			// stored one rather than persisting an empty string, which would
			// make every later refresh fail with invalid_request.
			this.tokenStore.updateTokens(
				userId,
				refreshed.accessToken,
				refreshed.refreshToken || token.refreshToken,
				refreshed.expiresAt,
			);
			return refreshed.accessToken;
		}

		return token.accessToken;
	}

	/** Deauthorize at the provider (if supported) and delete the stored token. */
	async deauthorize(userId: string): Promise<void> {
		const token = this.tokenStore.get(userId);
		if (token && this.provider.deauthorize) {
			try {
				const accessToken = await this.getValidToken(userId);
				await this.provider.deauthorize(accessToken);
			} catch (err) {
				console.warn(
					`[${this.provider.name}] Failed to deauthorize for user ${userId}:`,
					err,
				);
			}
		}
		this.tokenStore.delete(userId);
		console.log(`[${this.provider.name}] Disconnected user ${userId}`);
	}

	private async postToken(
		params: Record<string, string>,
		kind: "exchange" | "refresh",
	): Promise<Response> {
		const startedAt = Date.now();
		console.log(`[${this.provider.name}] Token ${kind} request starting`);
		const res = await fetch(this.provider.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(params),
		});
		console.log(
			`[${this.provider.name}] Token ${kind} completed in ${Date.now() - startedAt}ms with status ${res.status}`,
		);
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(
				`Token ${kind} failed: ${res.status}${body ? ` — ${body.slice(0, 300)}` : ""}`,
			);
		}
		return res;
	}
}
