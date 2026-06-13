import type { ModelMessage, StreamChunk } from "@tanstack/ai";
import type { ToolDefinition } from "@fit-analyzer/shared";

type OpenAiCompatibleToolCallDelta = {
	index?: number;
	id?: string;
	type?: "function";
	function?: {
		name?: string;
		arguments?: string;
	};
};

type OpenAiCompatibleStreamChunk = {
	choices?: Array<{
		delta?: {
			content?: string;
			reasoning?: string;
			reasoning_content?: string;
			reasoning_text?: string;
			tool_calls?: OpenAiCompatibleToolCallDelta[];
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

function toOpenAiTool(tool: ToolDefinition) {
	return {
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

function toOpenAiMessages(systemPrompt: string, messages: ModelMessage[]) {
	const mapped = messages
		.map((message) => {
			const content = messageContentToString(message.content);
			if (content == null && !message.toolCalls) return null;
			return {
				role: message.role,
				content: content ?? "",
				...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
				...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
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

interface ToolCallAccumulator {
	id: string;
	name: string;
	arguments: string;
}

function safeParseArgs(raw: string): Record<string, unknown> | null {
	if (!raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
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
	tools?: ToolDefinition[];
	messageId?: string;
}): AsyncGenerator<StreamChunk> {
	const runId = crypto.randomUUID();
	const messageId = options.messageId ?? crypto.randomUUID();
	const stepId = crypto.randomUUID();
	let stepStarted = false;
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

	const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
	const toolCallOrder: number[] = [];
	let toolCallDeltaCount = 0;

	yield {
		type: "RUN_STARTED",
		runId,
		threadId: options.threadId,
		model: options.model,
		timestamp: Date.now(),
	};

	// Emit TEXT_MESSAGE_START immediately so the tanstack processor creates
	// the assistant message with our ID before any STEP_FINISHED or other
	// events arrive (otherwise thinking gets its own separate message).
	yield {
		type: "TEXT_MESSAGE_START",
		messageId,
		role: "assistant",
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

	if (options.tools && options.tools.length > 0) {
		body.tools = options.tools.map(toOpenAiTool);
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

		if (delta?.tool_calls) {
			for (const tc of delta.tool_calls) {
				const idx = tc.index ?? 0;
				let acc = toolCallAccumulators.get(idx);
				if (!acc) {
					acc = {
						id: tc.id ?? `tool_${crypto.randomUUID()}`,
						name: tc.function?.name ?? "",
						arguments: "",
					};
					toolCallAccumulators.set(idx, acc);
					toolCallOrder.push(idx);
					yield {
						type: "TOOL_CALL_START",
						toolCallId: acc.id,
						toolName: acc.name,
						timestamp: Date.now(),
					};
				}
				if (tc.id) acc.id = tc.id;
				if (tc.function?.name) acc.name = tc.function.name;
				if (tc.function?.arguments) {
					acc.arguments += tc.function.arguments;
					toolCallDeltaCount++;
					yield {
						type: "TOOL_CALL_ARGS",
						toolCallId: acc.id,
						delta: tc.function.arguments,
						timestamp: Date.now(),
					};
				}
			}
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

	// Emit TOOL_CALL_END for every accumulated tool call so the client/UI
	// can finalize the call's parsed `input`.
	for (const idx of toolCallOrder) {
		const acc = toolCallAccumulators.get(idx);
		if (!acc) continue;
		yield {
			type: "TOOL_CALL_END",
			toolCallId: acc.id,
			toolName: acc.name,
			input: safeParseArgs(acc.arguments),
			timestamp: Date.now(),
		};
	}

	const requiresToolContinuation = finishReason === "tool_calls";

	if (!requiresToolContinuation) {
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
