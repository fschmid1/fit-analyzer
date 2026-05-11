import type { ModelMessage, StreamChunk } from "@tanstack/ai";

type OpenAiCompatibleStreamChunk = {
	choices?: Array<{
		delta?: {
			content?: string;
			reasoning?: string;
			reasoning_content?: string;
			reasoning_text?: string;
		};
		finish_reason?: "stop" | "length" | "content_filter" | "tool_calls" | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
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

function toOpenAiMessages(systemPrompt: string, messages: ModelMessage[]) {
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

async function* parseOpenAiSse(
	response: Response,
): AsyncGenerator<OpenAiCompatibleStreamChunk> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Stream body is not readable");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const events = buffer.split("\n\n");
		buffer = events.pop() ?? "";

		for (const event of events) {
			for (const line of event.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				const data = line.slice(6).trim();
				if (!data) continue;
				if (data === "[DONE]") return;
				yield JSON.parse(data) as OpenAiCompatibleStreamChunk;
			}
		}
	}
}

export async function* createTrainerStream(options: {
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	messages: ModelMessage[];
	includeReasoning?: boolean;
	metadata?: Record<string, unknown>;
	threadId?: string;
}): AsyncGenerator<StreamChunk> {
	const runId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const stepId = crypto.randomUUID();
	let stepStarted = false;
	let textStarted = false;
	let accumulatedText = "";
	let accumulatedReasoning = "";
	let finishReason: "stop" | "length" | "content_filter" | "tool_calls" | null =
		"stop";
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

	const body: Record<string, unknown> = {
		model: options.model,
		messages: toOpenAiMessages(options.systemPrompt, options.messages),
		stream: true,
	};

	if (options.includeReasoning) {
		body.include_reasoning = true;
	}

	if (options.metadata) {
		body.metadata = options.metadata;
	}

	const response = await fetch(`${options.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(
			`Stream failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
		);
	}

	for await (const chunk of parseOpenAiSse(response)) {
		const choice = chunk.choices?.[0];
		const delta = choice?.delta;

		if (options.includeReasoning) {
			const reasoningDelta =
				delta?.reasoning ??
				delta?.reasoning_content ??
				delta?.reasoning_text ??
				"";
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
		}

		const textDelta = delta?.content ?? "";
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

		if (choice?.finish_reason !== undefined) {
			finishReason = choice.finish_reason;
		}

		if (chunk.usage) {
			usage = {
				promptTokens: chunk.usage.prompt_tokens ?? 0,
				completionTokens: chunk.usage.completion_tokens ?? 0,
				totalTokens: chunk.usage.total_tokens ?? 0,
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
