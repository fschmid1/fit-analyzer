/**
 * Extract the authenticated user ID from the Authentik reverse-proxy header.
 *
 * Every API route is mounted behind an Authentik proxy that injects
 * `x-authentik-username` on every authenticated request. Routes call this
 * helper to pull the user; a missing header means the request did not pass
 * through the proxy (or the proxy dropped the header), so we throw and the
 * caller maps that to a 401.
 *
 * The parameter is a structural type so this works with any Hono context
 * (and with the lightweight test doubles used in oauth2.test.ts).
 */
export interface AuthentikContext {
	req: { header: (name: string) => string | undefined };
}

export function getUserId(c: AuthentikContext): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) throw new Error("Missing x-authentik-username header");
	return userId;
}
