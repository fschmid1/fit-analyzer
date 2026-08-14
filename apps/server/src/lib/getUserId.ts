/**
 * Extract the authenticated user ID from Authentik proxy headers.
 *
 * Every route handler that needs the current user duplicates this logic. It
 * is extracted here so the auth seam has a single home and the route
 * handlers can stay focused on dispatch.
 *
 * Throws when the `x-authentik-username` header is missing. Route handlers
 * are expected to catch and return a 401.
 */
export function getUserId(c: {
	req: { header: (name: string) => string | undefined };
}): string {
	const userId = c.req.header("x-authentik-username");
	if (!userId) throw new Error("Missing x-authentik-username header");
	return userId;
}
