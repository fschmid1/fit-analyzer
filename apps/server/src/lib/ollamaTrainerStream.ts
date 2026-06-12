import type { ModelMessage, StreamChunk } from "@tanstack/ai";
import type { ToolDefinition } from "@fit-analyzer/shared";
import { debug } from "./debug.js";

type OllamaToolCall = {
	id?: string;
	type?: "function";
	function?: { name?: string; arguments?: unknown };
};

type OllamaStreamChunk = {
	model?: string;
	created_at?: string;
	message?: {
		role?: string;
		content?: string;
		thinking?: string;
		tool_calls?: OllamaToolCall[];
	};
	done?: boolean;
	done_reason?: string;
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

function toOllamaTool(tool: ToolDefinition) {
	return {
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

function parseToolCallArgs(args: unknown): unknown {
	if (typeof args === "string") {
		try {
			return JSON.parse(args);
		} catch {
			return args;
		}
	}
	return args;
}

function toOllamaMessages(systemPrompt: string, messages: ModelMessage[]) {
	const mapped = messages
		.map((message) => {
			const content = messageContentToString(message.content);
			if (content == null && !message.toolCalls) return null;
			return {
				role: message.role,
				content: content ?? "",
				...(message.toolCalls
					? {
							tool_calls: message.toolCalls.map((tc) => ({
								...tc,
								function: {
									...tc.function,
									arguments: parseToolCallArgs(tc.function.arguments),
								},
							})),
						}
					: {}),
				...(message.role === "tool" && message.name
					? { tool_name: message.name }
					: {}),
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

function normalizeToolArgs(args: unknown): string {
	if (typeof args === "string") return args;
	if (args == null) return "";
	try {
		return JSON.stringify(args);
	} catch {
		return "";
	}
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

export async function* createOllamaTrainerStream(options: {
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	messages: ModelMessage[];
	tools?: ToolDefinition[];
	threadId?: string;
}): AsyncGenerator<StreamChunk> {
	const runId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
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

	const seenToolCallIds = new Set<string>();
	let toolCallDeltaCount = 0;

	debug.log("ollama-stream", "createOllamaTrainerStream start", {
		model: options.model,
		threadId: options.threadId,
		messageCount: options.messages.length,
		hasTools: Boolean(options.tools && options.tools.length > 0),
		toolCount: options.tools?.length ?? 0,
	});

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

	const requestBody: Record<string, unknown> = {
		model: options.model,
		messages: toOllamaMessages(options.systemPrompt, options.messages),
		stream: true,
	};
	if (options.tools && options.tools.length > 0) {
		requestBody.tools = options.tools.map(toOllamaTool);
	}

	const fetchStart = Date.now();
	debug.log("ollama-stream", "fetching /api/chat", {
		url: `${options.baseUrl}/api/chat`,
		model: options.model,
	});
	const response = await fetch(`${options.baseUrl}/api/chat`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(requestBody),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		debug.error("ollama-stream", "/api/chat non-OK", {
			status: response.status,
			statusText: response.statusText,
			errorText,
			elapsedMs: Date.now() - fetchStart,
		});
		throw new Error(
			`Ollama stream failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
		);
	}
	debug.log("ollama-stream", "/api/chat connected", {
		elapsedMs: Date.now() - fetchStart,
	});

	for await (const chunk of parseOllamaNdjson(response)) {
		if (chunk.done) {
			usage = {
				promptTokens: chunk.prompt_eval_count ?? 0,
				completionTokens: chunk.eval_count ?? 0,
				totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
			};
			if (chunk.done_reason === "length") {
				finishReason = "length";
			} else if (seenToolCallIds.size > 0) {
				finishReason = "tool_calls";
			} else {
				finishReason = "stop";
			}
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

		if (message?.tool_calls) {
			for (const tc of message.tool_calls) {
				const id = tc.id ?? `tool_${crypto.randomUUID()}`;
				const name = tc.function?.name ?? "";
				const argsString = normalizeToolArgs(tc.function?.arguments);

				if (!seenToolCallIds.has(id)) {
					seenToolCallIds.add(id);
					debug.log("ollama-stream", "tool call start", {
						toolCallId: id,
						toolName: name,
					});
					yield {
						type: "TOOL_CALL_START",
						toolCallId: id,
						toolName: name,
						timestamp: Date.now(),
					};
					if (argsString) {
						toolCallDeltaCount++;
						yield {
							type: "TOOL_CALL_ARGS",
							toolCallId: id,
							delta: argsString,
							timestamp: Date.now(),
						};
					}
					yield {
						type: "TOOL_CALL_END",
						toolCallId: id,
						toolName: name,
						input: safeParseArgs(argsString),
						timestamp: Date.now(),
					};
				}
			}
		}
	}

	debug.log("ollama-stream", "stream consumed", {
		finishReason,
		accumulatedTextBytes: accumulatedText.length,
		accumulatedReasoningBytes: accumulatedReasoning.length,
		toolCallCount: seenToolCallIds.size,
		toolCallDeltaCount,
		usage,
	});

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
