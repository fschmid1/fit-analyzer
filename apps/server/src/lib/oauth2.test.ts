import { describe, expect, it, mock } from "bun:test";
import {
	type OAuth2Provider,
	type OAuth2TokenStore,
	type StoredToken,
	OAuth2Flow,
} from "./oauth2.js";

// ─── fakes ────────────────────────────────────────────────────────────────────

interface InMemoryTokenStore extends OAuth2TokenStore {
	tokens: Map<string, StoredToken>;
	byProvider: Map<number, string>;
}

function makeTokenStore(): InMemoryTokenStore {
	const tokens = new Map<string, StoredToken>();
	const byProvider = new Map<number, string>();
	const store: InMemoryTokenStore = {
		tokens,
		byProvider,
		get: (userId) => tokens.get(userId) ?? null,
		getByProviderUserId: (id) => {
			const userId = byProvider.get(id);
			return userId ? (tokens.get(userId) ?? null) : null;
		},
		upsert: (token) => {
			tokens.set(token.userId, token);
			if (token.providerUserId != null)
				store.byProvider.set(token.providerUserId, token.userId);
		},
		updateTokens: (userId, accessToken, refreshToken, expiresAt) => {
			const existing = tokens.get(userId);
			if (!existing) return;
			tokens.set(userId, { ...existing, accessToken, refreshToken, expiresAt });
		},
		delete: (userId) => {
			const t = tokens.get(userId);
			if (t?.providerUserId != null) byProvider.delete(t.providerUserId);
			tokens.delete(userId);
		},
	};
	return store;
}

interface FakeProvider extends OAuth2Provider {
	tokenResponses: unknown[];
	exchangeCalls: Record<string, string>[];
	refreshCalls: Record<string, string>[];
	fetchUserCalls: number;
}

function makeProvider(opts: {
	name?: string;
	tokenResponse?: unknown;
	tokenResponses?: unknown[];
	withFetchUser?: boolean;
	withDeauthorize?: boolean;
}): FakeProvider {
	const responses = opts.tokenResponses ?? [];
	if (opts.tokenResponse) responses.push(opts.tokenResponse);
	const responseIdx = 0;
	const provider: FakeProvider = {
		name: opts.name ?? "test",
		authorizeUrl: "https://provider.test/oauth/authorize",
		tokenUrl: "https://provider.test/oauth/token",
		clientId: "cid",
		clientSecret: "csecret",
		redirectUri: "https://app.test/callback",
		scope: "read write",
		tokenResponses: responses,
		exchangeCalls: [],
		refreshCalls: [],
		fetchUserCalls: 0,
		parseTokenResponse: (body) => {
			const b = body as {
				access_token: string;
				refresh_token: string;
				expires_in?: number;
				expires_at?: number;
				athlete?: { id: number };
				user?: { id: number };
				scope?: string;
			};
			const expiresAt =
				b.expires_at ?? Math.floor(Date.now() / 1000) + (b.expires_in ?? 3600);
			return {
				accessToken: b.access_token,
				refreshToken: b.refresh_token,
				expiresAt,
				providerUserId: b.athlete?.id ?? b.user?.id ?? null,
				scope: b.scope,
			};
		},
		fetchProviderUserId: opts.withFetchUser
			? async () => {
					provider.fetchUserCalls++;
					return 4242;
				}
			: undefined,
		deauthorize: opts.withDeauthorize
			? async () => {
					/* noop */
				}
			: undefined,
	};
	return provider;
}

function mockFetch(responses: Response[]): ReturnType<typeof mock> {
	let i = 0;
	return mock(() => {
		const res = responses[i] ?? responses[responses.length - 1];
		i++;
		return Promise.resolve(res);
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("OAuth2Flow.buildAuthorizeUrl", () => {
	it("builds a URL with client_id, redirect_uri, response_type, scope, state", () => {
		const provider = makeProvider({});
		const flow = new OAuth2Flow(provider, makeTokenStore());
		const url = new URL(flow.buildAuthorizeUrl("state-123"));
		expect(url.searchParams.get("client_id")).toBe("cid");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://app.test/callback",
		);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("scope")).toBe("read write");
		expect(url.searchParams.get("state")).toBe("state-123");
	});

	it("includes extraAuthorizeParams when provided", () => {
		const provider = makeProvider({});
		provider.extraAuthorizeParams = { approval_prompt: "auto" };
		const flow = new OAuth2Flow(provider, makeTokenStore());
		const url = new URL(flow.buildAuthorizeUrl("s"));
		expect(url.searchParams.get("approval_prompt")).toBe("auto");
	});
});

describe("OAuth2Flow.exchangeCode", () => {
	it("posts to the token URL with the correct params and parses the response", async () => {
		const provider = makeProvider({
			tokenResponse: {
				access_token: "at-1",
				refresh_token: "rt-1",
				expires_in: 3600,
				athlete: { id: 99 },
				scope: "read",
			},
		});
		const store = makeTokenStore();
		const flow = new OAuth2Flow(provider, store);

		const fetchMock = mockFetch([jsonResponse(provider.tokenResponses[0])]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const parsed = await flow.exchangeCode("the-code");
			expect(parsed.accessToken).toBe("at-1");
			expect(parsed.refreshToken).toBe("rt-1");
			expect(parsed.providerUserId).toBe(99);
			expect(parsed.scope).toBe("read");

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("https://provider.test/oauth/token");
			expect(init.method).toBe("POST");
			const body = new URLSearchParams(init.body as string);
			expect(body.get("client_id")).toBe("cid");
			expect(body.get("client_secret")).toBe("csecret");
			expect(body.get("code")).toBe("the-code");
			expect(body.get("grant_type")).toBe("authorization_code");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("fetches the provider user id when the token response omits it", async () => {
		const provider = makeProvider({
			tokenResponse: {
				access_token: "at-1",
				refresh_token: "rt-1",
				expires_in: 3600,
			},
			withFetchUser: true,
		});
		const flow = new OAuth2Flow(provider, makeTokenStore());

		const fetchMock = mockFetch([jsonResponse(provider.tokenResponses[0])]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const parsed = await flow.exchangeCode("code");
			expect(parsed.providerUserId).toBe(4242);
			expect(provider.fetchUserCalls).toBe(1);
		} finally {
			globalThis.fetch = original;
		}
	});

	it("includes extraExchangeParams (e.g. Wahoo redirect_uri) in the body", async () => {
		const provider = makeProvider({
			tokenResponse: {
				access_token: "at",
				refresh_token: "rt",
				expires_in: 3600,
				user: { id: 1 },
			},
		});
		provider.extraExchangeParams = { redirect_uri: "https://app.test/cb" };
		const flow = new OAuth2Flow(provider, makeTokenStore());

		const fetchMock = mockFetch([jsonResponse(provider.tokenResponses[0])]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			await flow.exchangeCode("c");
			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const body = new URLSearchParams(init.body as string);
			expect(body.get("redirect_uri")).toBe("https://app.test/cb");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("throws when the token endpoint returns a non-OK status", async () => {
		const provider = makeProvider({});
		const flow = new OAuth2Flow(provider, makeTokenStore());
		const fetchMock = mockFetch([jsonResponse({}, 400)]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			await expect(flow.exchangeCode("c")).rejects.toThrow(
				"Token exchange failed: 400",
			);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("OAuth2Flow.refreshToken", () => {
	it("posts grant_type=refresh_token and parses the new token", async () => {
		const provider = makeProvider({
			tokenResponse: {
				access_token: "at-2",
				refresh_token: "rt-2",
				expires_in: 3600,
				athlete: { id: 7 },
			},
		});
		const flow = new OAuth2Flow(provider, makeTokenStore());
		const stored: StoredToken = {
			userId: "u1",
			accessToken: "at-1",
			refreshToken: "rt-1",
			expiresAt: 1,
			providerUserId: 7,
			scope: "read",
		};

		const fetchMock = mockFetch([jsonResponse(provider.tokenResponses[0])]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const parsed = await flow.refreshToken(stored);
			expect(parsed.accessToken).toBe("at-2");
			expect(parsed.refreshToken).toBe("rt-2");
			const init = fetchMock.mock.calls[0][1] as RequestInit;
			const body = new URLSearchParams(init.body as string);
			expect(body.get("grant_type")).toBe("refresh_token");
			expect(body.get("refresh_token")).toBe("rt-1");
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("OAuth2Flow.getValidToken", () => {
	it("returns the stored access token when it is not near expiry", async () => {
		const provider = makeProvider({});
		const store = makeTokenStore();
		store.upsert({
			userId: "u1",
			accessToken: "fresh-at",
			refreshToken: "rt",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			providerUserId: 1,
			scope: "read",
		});
		const flow = new OAuth2Flow(provider, store);
		expect(await flow.getValidToken("u1")).toBe("fresh-at");
	});

	it("refreshes and persists a new token when within the refresh margin", async () => {
		const provider = makeProvider({
			tokenResponse: {
				access_token: "new-at",
				refresh_token: "new-rt",
				expires_in: 7200,
				athlete: { id: 1 },
			},
		});
		const store = makeTokenStore();
		store.upsert({
			userId: "u1",
			accessToken: "old-at",
			refreshToken: "old-rt",
			expiresAt: Math.floor(Date.now() / 1000) + 30, // within 60s margin
			providerUserId: 1,
			scope: "read",
		});
		const flow = new OAuth2Flow(provider, store);

		const fetchMock = mockFetch([jsonResponse(provider.tokenResponses[0])]);
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const at = await flow.getValidToken("u1");
			expect(at).toBe("new-at");
			const updated = store.get("u1");
			expect(updated?.accessToken).toBe("new-at");
			expect(updated?.refreshToken).toBe("new-rt");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("throws when the user has no stored token", async () => {
		const provider = makeProvider({ name: "strava" });
		const flow = new OAuth2Flow(provider, makeTokenStore());
		await expect(flow.getValidToken("nobody")).rejects.toThrow(
			"Strava not connected for this user",
		);
	});
});

describe("OAuth2Flow.deauthorize", () => {
	it("calls the provider deauthorize hook and deletes the token", async () => {
		const provider = makeProvider({ withDeauthorize: true });
		const deauthSpy = mock(
			provider.deauthorize as (t: string) => Promise<void>,
		);
		provider.deauthorize = deauthSpy;
		const store = makeTokenStore();
		store.upsert({
			userId: "u1",
			accessToken: "at",
			refreshToken: "rt",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			providerUserId: 1,
			scope: "read",
		});
		const flow = new OAuth2Flow(provider, store);

		await flow.deauthorize("u1");
		expect(deauthSpy).toHaveBeenCalledTimes(1);
		expect(store.get("u1")).toBeNull();
	});

	it("still deletes the token when no deauthorize hook is present", async () => {
		const provider = makeProvider({});
		const store = makeTokenStore();
		store.upsert({
			userId: "u1",
			accessToken: "at",
			refreshToken: "rt",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			providerUserId: 1,
			scope: "read",
		});
		const flow = new OAuth2Flow(provider, store);
		await flow.deauthorize("u1");
		expect(store.get("u1")).toBeNull();
	});

	it("deletes the token even if deauthorize throws", async () => {
		const provider = makeProvider({});
		provider.deauthorize = async () => {
			throw new Error("provider down");
		};
		const store = makeTokenStore();
		store.upsert({
			userId: "u1",
			accessToken: "at",
			refreshToken: "rt",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			providerUserId: 1,
			scope: "read",
		});
		const flow = new OAuth2Flow(provider, store);
		await flow.deauthorize("u1");
		expect(store.get("u1")).toBeNull();
	});
});

describe("OAuth2Provider.parseTokenResponse (contract)", () => {
	it("Strava-style: expires_at absolute + athlete.id", () => {
		const provider = makeProvider({});
		const parsed = provider.parseTokenResponse({
			access_token: "a",
			refresh_token: "r",
			expires_at: 1000,
			athlete: { id: 42 },
			scope: "read",
		});
		expect(parsed).toEqual({
			accessToken: "a",
			refreshToken: "r",
			expiresAt: 1000,
			providerUserId: 42,
			scope: "read",
		});
	});

	it("Wahoo-style: expires_in relative + no user id in token", () => {
		const provider = makeProvider({});
		const before = Math.floor(Date.now() / 1000);
		const parsed = provider.parseTokenResponse({
			access_token: "a",
			refresh_token: "r",
			expires_in: 600,
		});
		expect(parsed.accessToken).toBe("a");
		expect(parsed.refreshToken).toBe("r");
		expect(parsed.expiresAt).toBeGreaterThanOrEqual(before + 600);
		expect(parsed.providerUserId).toBeNull();
	});
});
