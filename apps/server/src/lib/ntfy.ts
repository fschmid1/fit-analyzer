import { env } from "../env.js";

/**
 * `ntfy` transport for user notifications, shared by waxed-chain reminders and
 * Plan refresh. Host/token come from the server environment; the topic is
 * per-user (user_settings.ntfy_topic). One topic per user — every notification
 * lands in the same place.
 */

export interface NtfyMessage {
	title: string;
	body: string;
	/** Comma-separated ntfy tag names, e.g. "bicycle,maintenance". */
	tags?: string;
}

/** Send one notification. Throws when NTFY_HOST is missing or ntfy rejects it. */
export async function sendNtfy(
	topic: string,
	message: NtfyMessage,
): Promise<void> {
	if (!env.NTFY_HOST) {
		throw new Error("NTFY_HOST is not configured");
	}

	const headers = new Headers({
		"Content-Type": "text/plain; charset=utf-8",
		Title: message.title,
	});
	if (message.tags) headers.set("Tags", message.tags);
	if (env.NTFY_TOKEN) {
		// ntfy accepts access tokens via Basic auth with an empty username.
		headers.set(
			"Authorization",
			`Basic ${Buffer.from(`:${env.NTFY_TOKEN}`).toString("base64")}`,
		);
	}

	const response = await fetch(
		`${env.NTFY_HOST.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`,
		{ method: "POST", headers, body: message.body },
	);

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(
			`ntfy request failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`,
		);
	}
}
