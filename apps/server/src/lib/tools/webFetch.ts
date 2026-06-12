import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import { debug } from "../debug.js";
import type { ToolHandler } from "./registry.js";

export const webFetchDefinition: ToolDefinition = {
	name: "web_fetch",
	description:
		"Fetch the contents of a web page by URL. Use this when you need to read a specific article, documentation, or web page.",
	parameters: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "The full URL of the web page to fetch",
			},
		},
		required: ["url"],
	},
};

export const webFetchHandler: ToolHandler = async (args) => {
	const end = debug.time("tool", "web_fetch");
	try {
		const url = typeof args.url === "string" ? args.url.trim() : "";
		if (!url) {
			return {
				id: "",
				name: "web_fetch",
				content: "",
				display: null,
				error: "Missing required argument: url",
			};
		}

		debug.log("tool", "web_fetch fetch", { url });
		const response = await fetch(url, {
			headers: {
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"User-Agent": "Mozilla/5.0 (compatible; FitAnalyzerBot/1.0)",
			},
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			return {
				id: "",
				name: "web_fetch",
				content: "",
				display: null,
				error: `Fetch failed: ${response.status} ${response.statusText}`,
			};
		}

		const contentType = response.headers.get("content-type") ?? "";
		let text: string;
		if (contentType.includes("application/json")) {
			const json = await response.json();
			text = JSON.stringify(json, null, 2);
		} else {
			text = await response.text();
		}

		const MAX_LEN = 12_000;
		const trimmed =
			text.length > MAX_LEN
				? `${text.slice(0, MAX_LEN)}\n...[truncated]`
				: text;

		return {
			id: "",
			name: "web_fetch",
			content: trimmed,
			display: { url, status: response.status, length: text.length },
		};
	} finally {
		end();
	}
};
