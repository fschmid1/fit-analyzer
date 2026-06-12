import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

interface DuckDuckGoTopic {
	Text?: string;
	FirstURL?: string;
	Result?: string;
	Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
	Abstract?: string;
	AbstractText?: string;
	AbstractURL?: string;
	Heading?: string;
	Answer?: string;
	AnswerType?: string;
	Definition?: string;
	DefinitionURL?: string;
	RelatedTopics?: DuckDuckGoTopic[];
}

function flattenTopics(
	topics: DuckDuckGoTopic[] | undefined,
	depth = 0,
): DuckDuckGoTopic[] {
	if (!topics || depth > 2) return [];
	const out: DuckDuckGoTopic[] = [];
	for (const t of topics) {
		if (t.Text && t.FirstURL) {
			out.push({ Text: t.Text, FirstURL: t.FirstURL });
		}
		if (t.Topics && t.Topics.length > 0) {
			out.push(...flattenTopics(t.Topics, depth + 1));
		}
	}
	return out;
}

export const webSearchDefinition: ToolDefinition = {
	name: "web_search",
	description:
		"Search the web for current information about training, nutrition, events, weather, or any topic relevant to coaching.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query",
			},
		},
		required: ["query"],
	},
};

export const webSearchHandler: ToolHandler = async (args) => {
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) {
		return {
			id: "",
			name: "web_search",
			content: "",
			display: null,
			error: "Missing required argument: query",
		};
	}

	const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		return {
			id: "",
			name: "web_search",
			content: "",
			display: null,
			error: `Search failed: ${response.status} ${response.statusText}`,
		};
	}

	const data = (await response.json()) as DuckDuckGoResponse;
	const abstract = data.AbstractText?.trim() || data.Abstract?.trim() || "";
	const abstractUrl = data.AbstractURL?.trim() || "";
	const heading = data.Heading?.trim() || "";
	const answer = data.Answer?.trim() || "";
	const related = flattenTopics(data.RelatedTopics).slice(0, 8);

	const relatedDisplay = related.map((t) => ({
		text: (t.Text ?? "").replace(/\s+-\s+\S+\s*$/, "").trim(),
		url: t.FirstURL ?? "",
	}));

	const contentParts: string[] = [];
	if (heading) contentParts.push(`Heading: ${heading}`);
	if (abstract) contentParts.push(`Summary: ${abstract}`);
	if (answer) contentParts.push(`Answer: ${answer}`);
	if (relatedDisplay.length > 0) {
		contentParts.push(
			`Related topics:\n${relatedDisplay
				.map((t, i) => `${i + 1}. ${t.text}${t.url ? ` (${t.url})` : ""}`)
				.join("\n")}`,
		);
	}
	if (contentParts.length === 0) {
		contentParts.push(
			`No results returned for query "${query}". DuckDuckGo Instant Answer only covers well-known topics.`,
		);
	}

	const result: ToolResult = {
		id: "",
		name: "web_search",
		content: contentParts.join("\n\n"),
		display: {
			query,
			heading,
			abstract,
			abstractUrl,
			relatedTopics: relatedDisplay,
		},
	};
	return result;
};
