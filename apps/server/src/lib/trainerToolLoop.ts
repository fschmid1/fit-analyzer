import type { ModelMessage, StreamChunk, ToolCall } from "@tanstack/ai";
import type { ToolDefinition, ToolStreamChunk } from "@fit-analyzer/shared";
import { debug } from "./debug.js";
import { executeTool, getToolDefinitions } from "./tools/registry.js";
import type { ToolHandlerContext } from "./tools/registry.js";
import { createOllamaTrainerStream } from "./ollamaTrainerStream.js";
import { createTrainerStream } from "./trainerStream.js";

const DEFAULT_MAX_TOOL_ROUNDS = 5;

export interface TrainerToolLoopOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	messages: ModelMessage[];
	provider: "openrouter" | "ollama-cloud";
	includeReasoning?: boolean;
	metadata?: Record<string, unknown>;
	threadId?: string;
	userId: string;
	tools?: ToolDefinition[];
	maxToolRounds?: number;
}

type YieldedChunk = StreamChunk | ToolStreamChunk;

interface ToolCallObservation {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArgs(input: unknown): Record<string, unknown> | null {
	if (isRecord(input)) return input;
	if (typeof input === "string") {
		const trimmed = input.trim();
		if (!trimmed) return {};
		try {
			const parsed = JSON.parse(trimmed);
			return isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

function appendAssistantToolCallMessage(
	messages: ModelMessage[],
	observations: ToolCallObservation[],
): ModelMessage {
	const toolCalls: ToolCall[] = observations.map((o) => ({
		id: o.id,
		type: "function",
		function: {
			name: o.name,
			arguments: JSON.stringify(o.arguments),
		},
	}));
	return {
		role: "assistant",
		content: "",
		toolCalls,
	};
}

export async function* createTrainerToolLoop(
	options: TrainerToolLoopOptions,
): AsyncGenerator<YieldedChunk> {
	const maxRounds =
		options.maxToolRounds && options.maxToolRounds > 0
			? options.maxToolRounds
			: DEFAULT_MAX_TOOL_ROUNDS;
	const tools = options.tools ?? getToolDefinitions();
	const messages: ModelMessage[] = [...options.messages];

	debug.log("trainer-loop", "createTrainerToolLoop start", {
		provider: options.provider,
		model: options.model,
		maxRounds,
		toolCount: tools.length,
		toolNames: tools.map((t) => t.name),
		initialMessageCount: messages.length,
		userId: options.userId,
	});

	// Generate a single messageId that all rounds share so the tanstack
	// processor keeps everything in one assistant message.
	const sharedMessageId = crypto.randomUUID();

	for (let round = 0; round <= maxRounds; round++) {
		const isFirstRound = round === 0;
		const observations: ToolCallObservation[] = [];

		debug.log("trainer-loop", "round begin", {
			round,
			isFirstRound,
			messageCount: messages.length,
		});

		const stream =
			options.provider === "ollama-cloud"
				? createOllamaTrainerStream({
						baseUrl: options.baseUrl,
						apiKey: options.apiKey,
						model: options.model,
						systemPrompt: options.systemPrompt,
						messages,
						threadId: options.threadId,
						tools: tools.length > 0 ? tools : undefined,
						messageId: sharedMessageId,
					})
				: createTrainerStream({
						baseUrl: options.baseUrl,
						apiKey: options.apiKey,
						model: options.model,
						systemPrompt: options.systemPrompt,
						messages,
						includeReasoning: options.includeReasoning,
						metadata: options.metadata,
						threadId: options.threadId,
						tools: tools.length > 0 ? tools : undefined,
						messageId: sharedMessageId,
					});

		let finishReason:
			| "stop"
			| "length"
			| "content_filter"
			| "tool_calls"
			| null = "stop";
		let textStarted = false;
		let textEnded = false;
		const partialToolCalls = new Map<string, ToolCallObservation>();
		const roundStart = Date.now();
		let chunkCount = 0;
		let lastChunkType = "(none)";

		for await (const chunk of stream) {
			chunkCount++;
			lastChunkType = chunk.type;
			if (!isFirstRound && chunk.type === "RUN_STARTED") {
				// Suppress repeated RUN_STARTED on continuation rounds so the
				// client only sees a single logical run envelope.
				continue;
			}

			if (chunk.type === "TOOL_CALL_START") {
				const args = normalizeArgs((chunk as { input?: unknown }).input);
				partialToolCalls.set(chunk.toolCallId, {
					id: chunk.toolCallId,
					name: chunk.toolName,
					arguments: args ?? {},
				});
				debug.log("trainer-loop", "TOOL_CALL_START", {
					round,
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					parsedArgs: args ?? {},
				});
			}

			if (chunk.type === "TOOL_CALL_END") {
				const args = normalizeArgs((chunk as { input?: unknown }).input);
				partialToolCalls.set(chunk.toolCallId, {
					id: chunk.toolCallId,
					name: chunk.toolName,
					arguments: args ?? {},
				});
				debug.log("trainer-loop", "TOOL_CALL_END", {
					round,
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					parsedArgs: args ?? {},
				});
			}

			if (chunk.type === "RUN_FINISHED") {
				finishReason = chunk.finishReason;
				debug.log("trainer-loop", "RUN_FINISHED", {
					round,
					finishReason,
					elapsedMs: Date.now() - roundStart,
					chunkCount,
				});
			}

			if (chunk.type === "RUN_ERROR") {
				debug.error("trainer-loop", "RUN_ERROR", {
					round,
					error: (chunk as { error?: { message?: string } }).error?.message,
				});
			}

			if (chunk.type === "TEXT_MESSAGE_START") {
				textStarted = true;
			}

			if (chunk.type === "TEXT_MESSAGE_END") {
				textEnded = true;
			}

			yield chunk;
		}

		debug.log("trainer-loop", "round stream drained", {
			round,
			finishReason,
			textStarted,
			textEnded,
			partialToolCallCount: partialToolCalls.size,
			chunkCount,
			lastChunkType,
			elapsedMs: Date.now() - roundStart,
		});

		// If the stream ended in a text turn without sending TEXT_MESSAGE_END,
		// emit one so the client sees a well-formed envelope.
		if (textStarted && !textEnded && finishReason === "stop") {
			yield {
				type: "TEXT_MESSAGE_END",
				messageId: "loop-close",
				model: options.model,
				timestamp: Date.now(),
			};
		}

		if (finishReason !== "tool_calls") {
			// Plain stop/length/content_filter — the inner stream already
			// emitted RUN_FINISHED, so we're done.
			debug.log(
				"trainer-loop",
				"createTrainerToolLoop done (no tool continuation)",
				{
					round,
					finishReason,
				},
			);
			return;
		}

		// Preserve order of tool calls as they appeared in the stream.
		const ordered: ToolCallObservation[] = [];
		const seen = new Set<string>();
		for (const obs of partialToolCalls.values()) {
			if (!seen.has(obs.id)) {
				seen.add(obs.id);
				ordered.push(obs);
			}
		}
		observations.push(...ordered);

		debug.log("trainer-loop", "tool calls collected", {
			round,
			count: observations.length,
			names: observations.map((o) => o.name),
		});

		if (observations.length === 0) {
			// Provider reported tool_calls finish reason without any
			// TOOL_CALL_END — bail out to avoid an infinite loop.
			debug.warn("trainer-loop", "tool_calls finish without payload", {
				round,
			});
			yield {
				type: "RUN_ERROR",
				runId: crypto.randomUUID(),
				error: { message: "Provider requested tool_calls without payload" },
				timestamp: Date.now(),
			};
			return;
		}

		// Append the assistant message that contained the tool calls.
		messages.push(appendAssistantToolCallMessage(messages, observations));
		debug.log("trainer-loop", "appended assistant tool-call message", {
			round,
			messageCount: messages.length,
		});

		// Execute each tool sequentially and append tool-result messages.
		for (const obs of observations) {
			debug.log("trainer-loop", "execute tool begin", {
				round,
				toolCallId: obs.id,
				toolName: obs.name,
				args: obs.arguments,
			});
			const toolStart = Date.now();
			const toolContext: ToolHandlerContext = {
				userId: options.userId,
				threadId: options.threadId,
			};
			const toolResult = await executeTool(
				obs.name,
				obs.arguments,
				toolContext,
			);
			debug.log("trainer-loop", "execute tool end", {
				round,
				toolCallId: obs.id,
				toolName: obs.name,
				elapsedMs: Date.now() - toolStart,
				hasError: Boolean(toolResult.error),
				contentBytes: toolResult.content.length,
			});

			yield {
				type: "TOOL_RESULT",
				toolCallId: obs.id,
				toolName: obs.name,
				content: toolResult.content,
				display: toolResult.display,
				error: toolResult.error,
				timestamp: Date.now(),
			} satisfies ToolStreamChunk;

			const content = toolResult.error
				? `Error: ${toolResult.error}`
				: toolResult.content;
			messages.push({
				role: "tool",
				content,
				toolCallId: obs.id,
				name: obs.name,
			});
		}

		debug.log("trainer-loop", "all tool results appended", {
			round,
			messageCount: messages.length,
		});

		if (round === maxRounds) {
			// Safety: hit the round limit; stop looping and surface the
			// error to the client.
			debug.warn("trainer-loop", "max rounds reached", { round, maxRounds });
			yield {
				type: "RUN_ERROR",
				runId: crypto.randomUUID(),
				error: {
					message: `Tool loop exceeded ${maxRounds} rounds; aborting`,
				},
				timestamp: Date.now(),
			};
			return;
		}
	}
}
