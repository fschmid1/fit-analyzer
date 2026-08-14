import type { ModelMessage } from "@tanstack/ai";
import {
	getKimiRequestMetadata,
	sanitizeMessagesForModel,
} from "./providerConfig.js";
import { describe, expect, it } from "bun:test";

describe("providerConfig", () => {
	describe("getKimiRequestMetadata", () => {
		it("includes app, feature, context_cache, and user_id", () => {
			const meta = getKimiRequestMetadata("user-1");
			expect(meta.app).toBe("fit-analyzer");
			expect(meta.feature).toBe("trainer-chat");
			expect(meta.context_cache).toBe("openrouter-moonshot-automatic");
			expect(meta.user_id).toBe("user-1");
			expect(meta.thread_id).toBeUndefined();
			expect(meta.conversation_id).toBeUndefined();
		});

		it("includes thread_id when given", () => {
			const meta = getKimiRequestMetadata("user-1", "thread-abc");
			expect(meta.thread_id).toBe("thread-abc");
		});

		it("includes conversation_id when given", () => {
			const meta = getKimiRequestMetadata("user-1", "thread-abc", "conv-xyz");
			expect(meta.conversation_id).toBe("conv-xyz");
		});

		it("falls back conversation_id to thread_id when conversation_id is omitted", () => {
			const meta = getKimiRequestMetadata("user-1", "thread-abc");
			expect(meta.conversation_id).toBe("thread-abc");
		});

		it("omits thread_id and conversation_id when neither is given", () => {
			const meta = getKimiRequestMetadata("user-1");
			expect("thread_id" in meta).toBe(false);
			expect("conversation_id" in meta).toBe(false);
		});
	});

	describe("sanitizeMessagesForModel", () => {
		it("strips display from tool-call outputs", () => {
			const messages = [
				{
					id: "msg-1",
					role: "assistant" as const,
					parts: [
						{
							type: "tool-call" as const,
							toolCallId: "tc-1",
							toolName: "zone_analysis",
							state: "output-available" as const,
							input: { activityId: "act-1" },
							output: {
								result: {
									zones: [{ name: "Z1", seconds: 100 }],
									display: { chartData: [1, 2, 3, 4, 5] },
								},
							},
						},
					],
				},
			];
			const sanitized = sanitizeMessagesForModel(
				messages as unknown as Parameters<typeof sanitizeMessagesForModel>[0],
			);
			const part = (sanitized[0] as { parts: unknown[] }).parts[0] as {
				output: { result: { zones: unknown[]; display?: unknown } };
			};
			expect(part.output.result.zones).toEqual([{ name: "Z1", seconds: 100 }]);
			expect(part.output.result.display).toBeUndefined();
		});

		it("leaves non-tool-call parts untouched", () => {
			const messages = [
				{
					id: "msg-1",
					role: "user" as const,
					parts: [{ type: "text" as const, text: "hello" }],
				},
			];
			const sanitized = sanitizeMessagesForModel(
				messages as unknown as Parameters<typeof sanitizeMessagesForModel>[0],
			);
			expect((sanitized[0] as { parts: unknown[] }).parts[0]).toEqual({
				type: "text",
				text: "hello",
			});
		});

		it("leaves tool-call outputs without result untouched", () => {
			const messages = [
				{
					id: "msg-1",
					role: "assistant" as const,
					parts: [
						{
							type: "tool-call" as const,
							toolCallId: "tc-1",
							toolName: "noop",
							state: "output-available" as const,
							input: {},
							output: { plain: "no result key" },
						},
					],
				},
			];
			const sanitized = sanitizeMessagesForModel(
				messages as unknown as Parameters<typeof sanitizeMessagesForModel>[0],
			);
			const part = (sanitized[0] as { parts: unknown[] }).parts[0] as {
				output: { plain: string };
			};
			expect(part.output.plain).toBe("no result key");
		});

		it("passes through ModelMessage objects without parts", () => {
			const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
			const sanitized = sanitizeMessagesForModel(messages);
			expect(sanitized).toEqual([{ role: "user", content: "hello" }]);
		});
	});
});
