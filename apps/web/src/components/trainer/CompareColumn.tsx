import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { UIMessage } from "@tanstack/ai-react";
import { useChat } from "@tanstack/ai-react";
import type { StreamChunk } from "@tanstack/ai";
import type { ToolStreamChunk, UIToolCall } from "@fit-analyzer/shared";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import {
	AVAILABLE_MODELS,
	getCoachModelDisplayName,
	getModelProvider,
	type ModelEntry,
	type TrainerThread,
} from "@fit-analyzer/shared";
import { fetchTrainerHistory } from "../../lib/api";
import { createTrainerStreamConnection } from "../../lib/trainerStreamConnection";
import {
	clearActiveTrainerStream,
	clearTrainerDraft,
	loadActiveTrainerStream,
} from "../../lib/trainerStreamState";
import { DotsLoader } from "./DotsLoader";
import { ModelPicker } from "./ModelPicker";
import { ToolCallCard } from "./ToolCallCard";
import {
	applyResumedChunk,
	applyToolChunks,
	isToolChunk,
	stripTrailingAssistant,
	streamResumedChat,
	toUIMessage,
	toolCallsForMessage,
	trailingToolCalls,
} from "./trainerHelpers";
import { useTrainerHistoryPersist } from "./useTrainerHistoryPersist";
import { CompareMessageRow } from "./CompareMessageRow";

const PAGE_SIZE = 20;
const TOP_SENTINEL_THRESHOLD_PX = 200;

export type CompareColumnStatus = "submitted" | "streaming" | "ready" | "error";

export interface CompareColumnHandle {
	sendMessage: (text: string) => Promise<void>;
	stop: () => void;
	isLoading: boolean;
	status: CompareColumnStatus;
}

export interface CompareColumnProps {
	thread: TrainerThread;
	initialMessages: UIMessage[];
	initialNextCursor: string | null;
	initialHasMore: boolean;
	initialTotal: number;
	defaultModel: string | null;
	availableModels: ModelEntry[];
	favorites: string[];
	onModelChange: (modelId: string) => void;
	onToggleFavorite: (modelId: string) => void;
	onUnpin: () => void;
	onStatusChange?: (state: {
		isLoading: boolean;
		status: CompareColumnStatus;
	}) => void;
}
export const CompareColumn = forwardRef<
	CompareColumnHandle,
	CompareColumnProps
>(function CompareColumn(
	{
		thread,
		initialMessages,
		initialNextCursor,
		initialHasMore,
		initialTotal,
		defaultModel,
		availableModels,
		favorites,
		onModelChange,
		onToggleFavorite,
		onUnpin,
		onStatusChange,
	},
	ref,
) {
	const connectionRef = useRef<ReturnType<
		typeof createTrainerStreamConnection
	> | null>(null);
	if (connectionRef.current === null) {
		connectionRef.current = createTrainerStreamConnection(thread.id);
	}
	const [toolCalls, setToolCalls] = useState<UIToolCall[]>([]);
	const handleChunk = useCallback((chunk: StreamChunk | ToolStreamChunk) => {
		if (isToolChunk(chunk)) {
			setToolCalls((prev) => applyToolChunks(prev, chunk));
		}
	}, []);
	const { messages, sendMessage, status, isLoading, stop, error, setMessages } =
		useChat({
			connection: connectionRef.current,
			initialMessages,
			body: { threadId: thread.id },
			onChunk: handleChunk as unknown as (chunk: StreamChunk) => void,
		});

	// `useChat`'s `setMessages` doesn't support the updater form, so we
	// track the latest messages in a ref for safe async merging.
	const messagesRef = useRef<UIMessage[]>(messages);
	messagesRef.current = messages;

	// Pagination state
	const [nextCursor, setNextCursor] = useState<string | null>(
		initialNextCursor,
	);
	const [hasMore, setHasMore] = useState(initialHasMore);
	const [totalServerMessages, setTotalServerMessages] = useState(initialTotal);
	const [loadingMore, setLoadingMore] = useState(false);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	const loadingMoreRef = useRef(false);

	const sendMessageRef = useRef(sendMessage);
	const stopRef = useRef(stop);
	sendMessageRef.current = sendMessage;
	stopRef.current = stop;

	const handleRef = useRef<CompareColumnHandle>({
		sendMessage: async () => {},
		stop: () => {},
		isLoading: false,
		status: "ready",
	});
	handleRef.current = {
		sendMessage: async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			setTotalServerMessages((n) => n + 2);
			setToolCalls([]);
			await sendMessageRef.current(trimmed);
		},
		stop: () => {
			stopRef.current();
			clearActiveTrainerStream(thread.id);
		},
		isLoading,
		status,
	};

	useImperativeHandle(ref, () => handleRef.current, []);

	const [scrollTopShown, setScrollTopShown] = useState(false);
	const [scrollBottomShown, setScrollBottomShown] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);

	// Walk remaining pages so save / persist get a complete message set
	// even if the in-memory window is paginated.
	const ensureFullHistory = useCallback(
		async (current: UIMessage[]): Promise<UIMessage[]> => {
			if (!hasMore) return current;
			let cursor = nextCursor;
			let safety = 50;
			const collected: UIMessage[] = [];
			while (cursor && safety-- > 0) {
				const page = await fetchTrainerHistory(thread.id, undefined, {
					cursor,
					limit: PAGE_SIZE,
				});
				collected.push(...page.messages.map(toUIMessage));
				if (!page.hasMore || !page.nextCursor) break;
				cursor = page.nextCursor;
			}
			const byId = new Map<string, UIMessage>();
			for (const m of collected) byId.set(m.id, m);
			for (const m of current) byId.set(m.id, m);
			return [...byId.values()].sort(
				(a, b) =>
					new Date(a.createdAt ?? 0).getTime() -
					new Date(b.createdAt ?? 0).getTime(),
			);
		},
		[hasMore, nextCursor, thread.id],
	);

	useEffect(() => {
		const activeStream = loadActiveTrainerStream(thread.id);
		if (activeStream) {
			let baseMessages = stripTrailingAssistant(initialMessages);
			setMessages(baseMessages);
			setToolCalls([]);
			const abortController = new AbortController();

			streamResumedChat(
				activeStream.streamId,
				(chunk) => {
					baseMessages = applyResumedChunk(baseMessages, chunk);
					setMessages(baseMessages);
					if (isToolChunk(chunk)) {
						setToolCalls((prev) => applyToolChunks(prev, chunk));
					}

					if (
						chunk.type === "RUN_FINISHED" &&
						chunk.finishReason !== "tool_calls"
					) {
						clearActiveTrainerStream(thread.id);
						clearTrainerDraft(thread.id);
					}
					if (chunk.type === "RUN_ERROR") {
						clearActiveTrainerStream(thread.id);
						clearTrainerDraft(thread.id);
					}
				},
				abortController.signal,
			).catch((resumeError) => {
				if (resumeError instanceof Error && resumeError.name === "AbortError")
					return;
				console.error("Failed to resume trainer stream:", resumeError);
			});

			return () => abortController.abort();
		}

		// No active stream: just sync initial history without stripping assistant
		setMessages(initialMessages);
	}, [initialMessages, setMessages, thread.id]);

	useTrainerHistoryPersist(thread.id, messages, status, toolCalls, ensureFullHistory);

	const onStatusChangeRef = useRef(onStatusChange);
	useEffect(() => {
		onStatusChangeRef.current = onStatusChange;
	}, [onStatusChange]);

	useEffect(() => {
		onStatusChangeRef.current?.({ isLoading, status });
	}, [isLoading, status]);

	const scrollRafRef = useRef<number>(0);
	const updateScrollButtons = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (scrollRafRef.current) return;
		scrollRafRef.current = requestAnimationFrame(() => {
			scrollRafRef.current = 0;
			setScrollTopShown(el.scrollTop > 50);
			setScrollBottomShown(
				el.scrollTop < el.scrollHeight - el.clientHeight - 50,
			);
		});
	}, []);

	const loadOlderMessages = useCallback(async () => {
		if (loadingMoreRef.current) return;
		if (!hasMore || !nextCursor) return;
		const scroller = scrollRef.current;
		if (!scroller) return;
		loadingMoreRef.current = true;
		setLoadingMore(true);
		setLoadMoreError(null);
		const previousScrollHeight = scroller.scrollHeight;
		const previousScrollTop = scroller.scrollTop;
		try {
			const page = await fetchTrainerHistory(thread.id, undefined, {
				cursor: nextCursor,
				limit: PAGE_SIZE,
			});
			const older = page.messages.map(toUIMessage);
			const known = new Set(messagesRef.current.map((m) => m.id));
			const additions = older.filter((m) => !known.has(m.id));
			if (additions.length > 0) {
				setMessages([...additions, ...messagesRef.current]);
			}
			setNextCursor(page.nextCursor);
			setHasMore(page.hasMore);
			setTotalServerMessages(page.total);
			requestAnimationFrame(() => {
				const el = scrollRef.current;
				if (!el) return;
				const addedHeight = el.scrollHeight - previousScrollHeight;
				el.scrollTop = previousScrollTop + addedHeight;
			});
		} catch (err) {
			console.error("Failed to load older messages:", err);
			setLoadMoreError(err instanceof Error ? err.message : "Load failed");
		} finally {
			loadingMoreRef.current = false;
			setLoadingMore(false);
		}
	}, [hasMore, nextCursor, thread.id, setMessages]);

	const onScroll = useCallback(() => {
		updateScrollButtons();
		const el = scrollRef.current;
		if (!el) return;
		if (
			hasMore &&
			!loadingMoreRef.current &&
			el.scrollTop <= TOP_SENTINEL_THRESHOLD_PX
		) {
			void loadOlderMessages();
		}
	}, [hasMore, loadOlderMessages, updateScrollButtons]);

	const scrollToTop = () =>
		scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
	const scrollToBottom = () =>
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });

	const isFirstRender = useRef(true);
	const prevLastMessageId = useRef<string | undefined>(undefined);
	const lastMessageId = messages[messages.length - 1]?.id;
	const lastMessageTextLen = messages[messages.length - 1]?.parts?.length ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastMessageTextLen is intentionally included to re-trigger scroll during streaming updates to the same message id
	useEffect(() => {
		if (lastMessageId === undefined) {
			isFirstRender.current = false;
			return;
		}

		const behavior = isFirstRender.current ? "instant" : "auto";

		if (isFirstRender.current) {
			isFirstRender.current = false;
			prevLastMessageId.current = lastMessageId;
			bottomRef.current?.scrollIntoView({ behavior });
			setTimeout(updateScrollButtons, 60);
			return;
		}

		if (lastMessageId !== prevLastMessageId.current) {
			// New message added
			prevLastMessageId.current = lastMessageId;
			bottomRef.current?.scrollIntoView({ behavior });
			setTimeout(updateScrollButtons, 60);
			return;
		}

		// Same message, text changed (streaming)
		const el = scrollRef.current;
		if (el) {
			const wasNearBottom =
				el.scrollHeight - el.scrollTop - el.clientHeight < 80;
			if (wasNearBottom || status === "submitted") {
				bottomRef.current?.scrollIntoView({ behavior });
				setTimeout(updateScrollButtons, 60);
			} else {
				updateScrollButtons();
			}
		}
	}, [lastMessageId, lastMessageTextLen, updateScrollButtons, status]);

	const activeModel =
		thread.coachModel ??
		defaultModel ??
		availableModels[0]?.id ??
		AVAILABLE_MODELS[0].id;
	const coachModelName =
		availableModels.find((m) => m.id === activeModel)?.name ??
		getCoachModelDisplayName(activeModel);
	const providerLabel =
		getModelProvider(activeModel) === "ollama-cloud"
			? "Ollama Cloud"
			: "OpenRouter";

	return (
		<div
			className="flex flex-col min-h-0 min-w-0 h-full overflow-hidden bg-[#0f0b1a] border border-[rgba(139,92,246,0.12)] rounded-lg"
			style={{ touchAction: "manipulation" }}
		>
			<div className="flex items-center gap-2 px-3 py-2 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold text-[#f1f5f9]">
						{thread.name}
					</span>
					<span className="truncate text-[11px] text-[#94a3b8]">
						{status === "submitted" && "Sending…"}
						{status === "streaming" && "Responding…"}
						{(status === "ready" || status === "error") &&
							`${coachModelName} · ${providerLabel} · ${totalServerMessages} message${totalServerMessages === 1 ? "" : "s"}`}
					</span>
				</div>
				<ModelPicker
					currentModel={thread.coachModel}
					defaultModel={defaultModel}
					availableModels={availableModels}
					onChange={onModelChange}
					favorites={favorites}
					onToggleFavorite={onToggleFavorite}
				/>
				<button
					type="button"
					onClick={onUnpin}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 text-[#94a3b8] hover:text-rose-400 hover:border-rose-500/30 transition-colors"
					title="Unpin from compare"
					aria-label="Unpin from compare"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="flex-1 relative min-h-0">
				<div
					ref={scrollRef}
					onScroll={onScroll}
					className="absolute inset-0 overflow-y-auto px-3 py-4 space-y-4"
				>
					{hasMore && (
						<div className="flex justify-center pt-1">
							{loadingMore ? (
								<span className="flex items-center gap-2 text-[11px] text-[#7c6fa0]">
									<Loader2 className="w-3 h-3 animate-spin" />
									Loading earlier…
								</span>
							) : loadMoreError ? (
								<button
									type="button"
									onClick={() => void loadOlderMessages()}
									className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
								>
									{loadMoreError} · Tap to retry
								</button>
							) : (
								<span className="text-[10px] text-[#4a4468]">
									Scroll up for older messages
								</span>
							)}
						</div>
					)}

					{messages.length === 0 && !hasMore && (
						<div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-50">
							<div className="w-10 h-10 rounded-lg bg-[#8b5cf6]/20 flex items-center justify-center">
								<span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
							</div>
							<p className="text-xs text-[#94a3b8]">
								Send a message to start comparing.
							</p>
						</div>
					)}

					{messages.map((msg) => {
						const isLastMsg = msg.id === lastMessageId;
						const isCurrentlyStreaming = isLastMsg && status === "streaming";
						const callsForMsg = toolCallsForMessage(
							messages,
							toolCalls,
							msg.id,
						);

						return (
							<CompareMessageRow
								key={msg.id}
								msg={msg}
								isLastMsg={isLastMsg}
								isCurrentlyStreaming={isCurrentlyStreaming}
								toolCalls={callsForMsg}
							/>
						);
					})}

					{trailingToolCalls(messages, toolCalls).length > 0 && (
						<div className="ml-2 flex max-w-full flex-col gap-1.5">
							{trailingToolCalls(messages, toolCalls).map((tc) => (
								<ToolCallCard key={tc.id} toolCall={tc} defaultExpanded />
							))}
						</div>
					)}

					{status === "submitted" && (
						<div className="flex justify-start">
							<div className="bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] rounded-lg px-4 py-3">
								<DotsLoader />
							</div>
						</div>
					)}

					{error && (
						<div className="flex justify-start">
							<div className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400 [overflow-wrap:anywhere]">
								Error: {error.message}
							</div>
						</div>
					)}

					<div ref={bottomRef} />
				</div>

				{(scrollTopShown || scrollBottomShown) && (
					<div className="absolute bottom-2 right-2 flex flex-col gap-1 z-10">
						{scrollTopShown && (
							<button
								type="button"
								onClick={scrollToTop}
								title="Scroll to top"
								className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] text-[#7c6fa0] hover:text-[#c4b5fd] cursor-pointer"
							>
								<ArrowUp className="w-3 h-3" />
							</button>
						)}
						{scrollBottomShown && (
							<button
								type="button"
								onClick={scrollToBottom}
								title="Scroll to bottom"
								className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] text-[#7c6fa0] hover:text-[#c4b5fd] cursor-pointer"
							>
								<ArrowDown className="w-3 h-3" />
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
});
