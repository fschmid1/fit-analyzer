import { randomUUID } from "node:crypto";
import type { TrainerMessage } from "@fit-analyzer/shared";

/** Strip <details>…</details> reasoning blocks from assistant text */
function stripDetails(text: string): string {
	return text.replace(/<details[\s\S]*?<\/details>/gi, "").trim();
}

/**
 * Parse a ChatGPT-style markdown export into an ordered list of TrainerMessages.
 *
 * Expected format:
 *   # Title
 *   Created: DD/MM/YYYY, HH:MM:SS
 *   ---
 *   ### User
 *   …
 *   ---
 *   ### Assistant (model-name)
 *   …
 */
export function parseCoachingMarkdown(raw: string): TrainerMessage[] {
	const sections = raw.split(/\n---\n/);

	// Derive a base timestamp from the file header ("Created: DD/MM/YYYY, HH:MM:SS")
	const header = sections[0] ?? "";
	const m = header.match(
		/Created:\s*(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/,
	);
	const baseTime = m
		? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`).getTime()
		: Date.now();

	const messages: TrainerMessage[] = [];
	let idx = 0;

	for (const section of sections) {
		const trimmed = section.trim();
		let role: "user" | "assistant" | null = null;
		let contentStart = 0;

		if (/^###\s+User/.test(trimmed)) {
			role = "user";
			contentStart = trimmed.indexOf("\n") + 1;
		} else if (/^###\s+Assistant/.test(trimmed)) {
			role = "assistant";
			contentStart = trimmed.indexOf("\n") + 1;
		} else {
			continue;
		}

		let content = trimmed.slice(contentStart).trim();
		if (role === "assistant") content = stripDetails(content);
		if (!content) continue;

		messages.push({
			id: randomUUID(),
			role,
			content,
			createdAt: new Date(baseTime + idx * 30_000).toISOString(),
		});
		idx++;
	}

	return messages;
}

export interface SerializeCoachingMarkdownOptions {
	/** Thread title (rendered as the `# Title` header line). */
	title: string;
	/** Coach model identifier to label assistant sections, e.g. "openrouter:anthropic/claude-3.5". */
	coachModel?: string | null;
	/** Base timestamp; defaults to the first message's `createdAt` or now. */
	createdAt?: string | Date;
}

/** Format a `Date` as `DD/MM/YYYY, HH:MM:SS` in local time (matches the parser). */
function formatCreatedAt(value: string | Date): string {
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return new Date().toLocaleString("en-GB");
	const pad = (n: number) => n.toString().padStart(2, "0");
	return (
		`${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/**
 * Serialize `TrainerMessage[]` into the ChatGPT-style markdown that
 * `parseCoachingMarkdown` consumes, producing a document that round-trips.
 */
export function serializeCoachingMarkdown(
	messages: TrainerMessage[],
	options: SerializeCoachingMarkdownOptions,
): string {
	const { title, coachModel } = options;
	const createdAt = options.createdAt ?? messages[0]?.createdAt ?? new Date();
	const assistantLabel = coachModel
		? `### Assistant (${coachModel})`
		: "### Assistant";

	const body = messages
		.map((m) => {
			const heading = m.role === "user" ? "### User" : assistantLabel;
			return `${heading}\n${m.content.trim()}`;
		})
		.join("\n---\n");

	return `# ${title}\nCreated: ${formatCreatedAt(createdAt)}\n---\n${body}\n`;
}
