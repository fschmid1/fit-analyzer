import type { ModelMessage, StreamChunk } from "@tanstack/ai";

type OllamaStreamChunk = {
	model?: string;
	created_at?: string;
	message?: {
		role?: string;
		content?: string;
		thinking?: string;
	};
	done?: boolean;
	prompt_eval_count?: number;
	eval_count?: number;
};

function messageContentToString(
	content: ModelMessage["content"],
): string | null {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;

	const text = content
		.filter(
			(part): part is Extract<typeof part, { type: "text" }> =>
				part.type === "text",
		)
		.map((part) => part.content)
		.join("\n");

	return text || null;
}

function toOllamaMessages(systemPrompt: string, messages: ModelMessage[]) {
	const mapped = messages
		.map((message) => {
			const content = messageContentToString(message.content);
			if (content == null) return null;
			return {
				role: message.role,
				content,
			};
		})
		.filter(
			(message): message is { role: ModelMessage["role"]; content: string } =>
				message !== null,
		);

	return [{ role: "system", content: systemPrompt }, ...mapped];
}

async function* parseOllamaNdjson(
	response: Response,
): AsyncGenerator<OllamaStreamChunk> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Ollama stream body is not readable");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			yield JSON.parse(trimmed) as OllamaStreamChunk;
		}
	}

	// Flush any remaining buffer
	const trimmed = buffer.trim();
	if (trimmed) {
		yield JSON.parse(trimmed) as OllamaStreamChunk;
	}
}

export async function* createOllamaTrainerStream(options: {
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	messages: ModelMessage[];
	threadId?: string;
}): AsyncGenerator<StreamChunk> {
	const runId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const stepId = crypto.randomUUID();
	let stepStarted = false;
	let textStarted = false;
	let accumulatedText = "";
	let accumulatedReasoning = "";
	const finishReason:
		| "stop"
		| "length"
		| "content_filter"
		| "tool_calls"
		| null = "stop";
	let usage:
		| {
				promptTokens: number;
				completionTokens: number;
				totalTokens: number;
		  }
		| undefined;

	yield {
		type: "RUN_STARTED",
		runId,
		threadId: options.threadId,
		model: options.model,
		timestamp: Date.now(),
	};

	const response = await fetch(`${options.baseUrl}/api/chat`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: options.model,
			messages: toOllamaMessages(options.systemPrompt, options.messages),
			stream: true,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(
			`Ollama stream failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
		);
	}

	for await (const chunk of parseOllamaNdjson(response)) {
		if (chunk.done) {
			usage = {
				promptTokens: chunk.prompt_eval_count ?? 0,
				completionTokens: chunk.eval_count ?? 0,
				totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
			};
			break;
		}

		const message = chunk.message;
		const reasoningDelta = message?.thinking ?? "";
		if (reasoningDelta) {
			if (!stepStarted) {
				stepStarted = true;
				yield {
					type: "STEP_STARTED",
					stepId,
					stepType: "thinking",
					model: options.model,
					timestamp: Date.now(),
				};
			}

			accumulatedReasoning += reasoningDelta;
			yield {
				type: "STEP_FINISHED",
				stepId,
				delta: reasoningDelta,
				content: accumulatedReasoning,
				model: options.model,
				timestamp: Date.now(),
			};
		}

		const textDelta = message?.content ?? "";
		if (textDelta) {
			if (!textStarted) {
				textStarted = true;
				yield {
					type: "TEXT_MESSAGE_START",
					messageId,
					role: "assistant",
					model: options.model,
					timestamp: Date.now(),
				};
			}

			accumulatedText += textDelta;
			yield {
				type: "TEXT_MESSAGE_CONTENT",
				messageId,
				delta: textDelta,
				content: accumulatedText,
				model: options.model,
				timestamp: Date.now(),
			};
		}
	}

	if (textStarted) {
		yield {
			type: "TEXT_MESSAGE_END",
			messageId,
			model: options.model,
			timestamp: Date.now(),
		};
	}

	yield {
		type: "RUN_FINISHED",
		runId,
		finishReason,
		usage,
		model: options.model,
		timestamp: Date.now(),
	};
}
