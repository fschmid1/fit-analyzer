import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@tanstack/ai-react";
import type { UIMessage } from "@tanstack/ai-react";
import type { StreamChunk } from "@tanstack/ai";
import type { ToolStreamChunk, UIToolCall } from "@fit-analyzer/shared";
import {
	ArrowDown,
	ArrowUp,
	Loader2,
	Menu,
	Send,
	Square,
	Upload,
} from "lucide-react";
import {
	AVAILABLE_MODELS,
	getCoachModelDisplayName,
	getModelProvider,
	type ModelEntry,
} from "@fit-analyzer/shared";
import {
	fetchTrainerHistory,
	importTrainerChat,
	saveTrainerHistory,
} from "../../lib/api";
import { createTrainerStreamConnection } from "../../lib/trainerStreamConnection";
import {
	clearActiveTrainerStream,
	clearTrainerDraft,
	loadActiveTrainerStream,
	loadTrainerDraft,
} from "../../lib/trainerStreamState";
import { ModelPicker } from "./ModelPicker";
import {
	applyResumedChunk,
	applyToolChunks,
	getTextContent,
	isToolChunk,
	stripTrailingAssistant,
	streamResumedChat,
	toTrainerMessage,
	toUIMessage,
	toolCallsForMessage,
	trailingToolCalls,
} from "./trainerHelpers";
import { useTrainerHistoryPersist } from "./useTrainerHistoryPersist";
import { DotsLoader } from "./DotsLoader";
import { ChatMessageRow } from "./ChatMessageRow";
import { ToolCallCard } from "./ToolCallCard";

const PAGE_SIZE = 20;
const TOP_SENTINEL_THRESHOLD_PX = 200;

interface TrainerChatProps {
	threadId: string;
	activityId: string;
	initialMessages: UIMessage[];
	initialInput: string;
	initialNextCursor: string | null;
	initialHasMore: boolean;
	initialTotal: number;
	autoSend?: boolean;
	onBack: () => void;
	onOpenThreads: () => void;
	onImported: () => void;
	threadModel: string | null;
	defaultModel: string | null;
	availableModels: ModelEntry[];
	onModelChange: (modelId: string) => void;
	favorites: string[];
	onToggleFavorite: (modelId: string) => void;
}

export function TrainerChat({
	threadId,
	activityId,
	initialMessages,
	initialInput,
	initialNextCursor,
	initialHasMore,
	initialTotal,
	autoSend,
	onBack,
	onOpenThreads,
	onImported,
	threadModel,
	defaultModel,
	availableModels,
	onModelChange,
	favorites,
	onToggleFavorite,
}: TrainerChatProps) {
	const connectionRef = useRef<ReturnType<
		typeof createTrainerStreamConnection
	> | null>(null);
	if (connectionRef.current === null) {
		connectionRef.current = createTrainerStreamConnection(threadId);
	}
	const [toolCalls, setToolCalls] = useState<UIToolCall[]>([]);
	const toolCallsRef = useRef<UIToolCall[]>([]);
	toolCallsRef.current = toolCalls;
	const handleChunk = useCallback((chunk: StreamChunk | ToolStreamChunk) => {
		if (isToolChunk(chunk)) {
			setToolCalls((prev) => applyToolChunks(prev, chunk));
		}
	}, []);
	const {
		messages,
		sendMessage,
		status,
		isLoading,
		stop,
		error,
		setMessages,
		reload,
	} = useChat({
		connection: connectionRef.current,
		initialMessages,
		body: { threadId },
		onChunk: handleChunk as unknown as (chunk: StreamChunk) => void,
	});

	const inputRef = useRef(initialInput);
	const [hasInput, setHasInput] = useState(!!initialInput.trim());
	const [importState, setImportState] = useState<
		"idle" | "loading" | "done" | "error"
	>("idle");
	const [importError, setImportError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showScrollTop, setShowScrollTop] = useState(false);
	const [showScrollBottom, setShowScrollBottom] = useState(false);
	const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<
		string | null
	>(null);
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

	const activeModel =
		threadModel ??
		defaultModel ??
		availableModels[0]?.id ??
		AVAILABLE_MODELS[0].id;
	const coachModelName =
		availableModels.find((m) => m.id === activeModel)?.name ??
		getCoachModelDisplayName(activeModel);

	useEffect(() => {
		const activeStream = loadActiveTrainerStream(threadId);
		if (!activeStream) return;

		const abortController = new AbortController();
		let baseMessages = stripTrailingAssistant(initialMessages);
		setMessages(baseMessages);
		setToolCalls([]);

		streamResumedChat(
			activeStream.streamId,
			(chunk) => {
				baseMessages = applyResumedChunk(baseMessages, chunk);
				setMessages(baseMessages);
				if (isToolChunk(chunk)) {
					setToolCalls((prev) => applyToolChunks(prev, chunk));
				}

				if (chunk.type === "RUN_FINISHED" || chunk.type === "RUN_ERROR") {
					clearActiveTrainerStream(threadId);
					clearTrainerDraft(threadId);
					// `useTrainerHistoryPersist` will save the full merged history
					// on the streaming → ready transition.
				}
			},
			abortController.signal,
		).catch((resumeError) => {
			if (resumeError instanceof Error && resumeError.name === "AbortError")
				return;
			console.error("Failed to resume trainer stream:", resumeError);
		});

		return () => abortController.abort();
	}, [initialMessages, setMessages, threadId]);

	const autoSentRef = useRef(false);

	useEffect(() => {
		if (!autoSend || autoSentRef.current) return;
		const text = inputRef.current.trim();
		if (!text) return;
		autoSentRef.current = true;
		inputRef.current = "";
		if (textareaRef.current) textareaRef.current.value = "";
		setHasInput(false);
		sendMessage(text);
	}, [autoSend, sendMessage]);

	const handleFileChange = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;
			e.target.value = "";
			setImportState("loading");
			setImportError(null);
			try {
				await importTrainerChat(file, threadId);
				setImportState("done");
				setTimeout(() => setImportState("idle"), 3000);
				onImported();
			} catch (err) {
				setImportError(err instanceof Error ? err.message : "Import failed");
				setImportState("error");
				setTimeout(() => setImportState("idle"), 5000);
			}
		},
		[threadId, onImported],
	);

	const scrollRafRef = useRef<number>(0);
	const updateScrollButtons = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (scrollRafRef.current) return;
		scrollRafRef.current = requestAnimationFrame(() => {
			scrollRafRef.current = 0;
			setShowScrollTop(el.scrollTop > 50);
			setShowScrollBottom(
				el.scrollTop < el.scrollHeight - el.clientHeight - 50,
			);
		});
	}, []);

	const scrollToTop = useCallback(
		() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }),
		[],
	);
	const scrollToBottom = useCallback(
		() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
		[],
	);

	useEffect(() => {
		updateScrollButtons();
	}, [updateScrollButtons]);

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

	// Infinite scroll: load older pages when sentinel is near the top.
	const loadOlderMessages = useCallback(async () => {
		if (loadingMoreRef.current) return;
		if (!hasMore || !nextCursor) return;
		const scroller = scrollRef.current;
		if (!scroller) return;
		loadingMoreRef.current = true;
		setLoadingMore(true);
		setLoadMoreError(null);
		// Snapshot the scroll geometry so we can restore the user's viewport
		// after the older page is prepended to the message list.
		const previousScrollHeight = scroller.scrollHeight;
		const previousScrollTop = scroller.scrollTop;
		try {
			const page = await fetchTrainerHistory(threadId, undefined, {
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
			// Wait one frame so the new content is in the DOM, then re-anchor
			// the scroll position to the first previously-visible message.
			requestAnimationFrame(() => {
				const el = scrollRef.current;
				if (!el) return;
				const addedHeight = el.scrollHeight - previousScrollHeight;
				el.scrollTop = previousScrollTop + addedHeight;
				updateScrollButtons();
			});
		} catch (err) {
			console.error("Failed to load older messages:", err);
			setLoadMoreError(err instanceof Error ? err.message : "Load failed");
		} finally {
			loadingMoreRef.current = false;
			setLoadingMore(false);
		}
	}, [hasMore, nextCursor, threadId, setMessages, updateScrollButtons]);

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

	// Before saving, make sure we have the full server history. The local
	// window may be a paginated subset, and PUT replaces the whole row set.
	const ensureFullHistory = useCallback(
		async (current: UIMessage[]): Promise<UIMessage[]> => {
			if (!hasMore) return current;
			// Walk all remaining pages so the saved list is complete.
			let cursor = nextCursor;
			let safety = 50;
			const collected: UIMessage[] = [];
			while (cursor && safety-- > 0) {
				const page = await fetchTrainerHistory(threadId, undefined, {
					cursor,
					limit: PAGE_SIZE,
				});
				collected.push(...page.messages.map(toUIMessage));
				if (!page.hasMore || !page.nextCursor) break;
				cursor = page.nextCursor;
			}
			// Local state wins over server state for any id collisions
			// (e.g. messages the user just edited or deleted).
			const byId = new Map<string, UIMessage>();
			for (const m of collected) byId.set(m.id, m);
			for (const m of current) byId.set(m.id, m);
			return [...byId.values()].sort(
				(a, b) =>
					new Date(a.createdAt ?? 0).getTime() -
					new Date(b.createdAt ?? 0).getTime(),
			);
		},
		[hasMore, nextCursor, threadId],
	);

	useTrainerHistoryPersist(threadId, messages, status, ensureFullHistory);

	const handleSend = useCallback(async () => {
		const text = inputRef.current.trim();
		if (!text || isLoading) return;
		inputRef.current = "";
		if (textareaRef.current) textareaRef.current.value = "";
		setHasInput(false);
		// Optimistic total so the next save recognises the new tail.
		setTotalServerMessages((n) => n + 2);
		setToolCalls([]);
		await sendMessage(text);
	}, [isLoading, sendMessage]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const handleConfirmDelete = useCallback(
		(messageId: string) => {
			setConfirmDeleteMessageId(null);
			const nextMessages = messages.filter((m) => m.id !== messageId);
			setMessages(nextMessages);
			setTotalServerMessages((n) => Math.max(0, n - 1));
			// Tool calls are ephemeral and grouped with the latest assistant
			// message; clearing them on delete keeps the UI consistent.
			setToolCalls([]);
			(async () => {
				const full = await ensureFullHistory(nextMessages);
				const toSave = full
					.filter((m) => m.role === "user" || m.role === "assistant")
					.map(toTrainerMessage)
					.filter((m) => m.content);
				saveTrainerHistory(threadId, toSave).catch(console.error);
			})();
			clearTrainerDraft(threadId);
		},
		[messages, setMessages, threadId, ensureFullHistory],
	);

	const isGeneralChat = activityId === "general";

	return (
		<div
			className="flex-1 flex flex-col min-h-0 min-w-0"
			style={{ touchAction: "manipulation" }}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".md,text/markdown,text/plain"
				className="hidden"
				onChange={handleFileChange}
			/>

			{/* Sub-header */}
			<div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6 sm:py-4 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
				<button
					type="button"
					onClick={onOpenThreads}
					className="flex items-center justify-center w-10 h-10 text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-lg transition-all duration-200 cursor-pointer md:hidden"
					title="Threads"
				>
					<Menu className="w-4 h-4" />
				</button>

				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-sm font-semibold text-[#f1f5f9]">
						{isGeneralChat ? "Cycling Coach" : "AI Trainer"}
					</span>
					<span className="truncate text-xs text-[#94a3b8]">
						{status === "submitted" && "Sending…"}
						{status === "streaming" && "Responding…"}
						{(status === "ready" || status === "error") &&
							(coachModelName
								? `${coachModelName} via ${getModelProvider(activeModel) === "ollama-cloud" ? "Ollama Cloud" : "OpenRouter"} · ${totalServerMessages} message${totalServerMessages === 1 ? "" : "s"}`
								: "Coach")}
					</span>
				</div>

				<div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-auto sm:flex sm:items-center">
					{isGeneralChat && messages.length === 0 && (
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							disabled={importState === "loading"}
							title="Import ChatGPT markdown export"
							className={`flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 cursor-pointer disabled:cursor-wait ${
								importState === "done"
									? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
									: importState === "error"
										? "bg-rose-500/10 border-rose-500/20 text-rose-400"
										: "bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#c4b5fd] hover:bg-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
							}`}
						>
							<Upload className="w-3.5 h-3.5" />
							<span className="truncate">
								{importState === "loading" && "Importing…"}
								{importState === "done" && "Imported!"}
								{importState === "error" && (importError ?? "Error")}
								{importState === "idle" && "Import .md"}
							</span>
						</button>
					)}
				</div>
			</div>

			{/* Messages */}
			<div className="flex-1 relative min-h-0">
				<div
					ref={scrollRef}
					onScroll={onScroll}
					className="absolute inset-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 space-y-4"
				>
					{hasMore && (
						<div className="flex justify-center pt-1">
							{loadingMore ? (
								<span className="flex items-center gap-2 text-xs text-[#7c6fa0]">
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
									Loading earlier messages…
								</span>
							) : loadMoreError ? (
								<button
									type="button"
									onClick={() => void loadOlderMessages()}
									className="text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
								>
									{loadMoreError} · Tap to retry
								</button>
							) : (
								<span className="text-[11px] text-[#4a4468]">
									Scroll up for older messages
								</span>
							)}
						</div>
					)}

					{messages.length === 0 && !hasMore && (
						<div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-50">
							<div className="w-12 h-12 rounded-lg bg-[#8b5cf6]/20 flex items-center justify-center">
								<Send className="w-5 h-5 text-[#8b5cf6]" />
							</div>
							<p className="text-sm text-[#94a3b8]">
								Paste your activity data below and ask your trainer anything.
							</p>
						</div>
					)}

					{messages.map((msg, msgIndex) => {
						const isLastMsg = msg.id === lastMessageId;
						const isCurrentlyStreaming = isLastMsg && status === "streaming";
						const callsForMsg = toolCallsForMessage(
							messages,
							toolCalls,
							msg.id,
						);

						const handleRetry = async () => {
							const msgText = getTextContent(msg);
							if (msg.role === "user") {
								if (isLoading) stop();
								const truncated = messages.slice(0, msgIndex);
								setMessages(truncated);
								setToolCalls([]);
								const full = await ensureFullHistory(truncated);
								const toSave = full
									.filter((m) => m.role === "user" || m.role === "assistant")
									.map(toTrainerMessage)
									.filter((m) => m.content);
								saveTrainerHistory(threadId, toSave).catch(console.error);
								setTotalServerMessages((n) => Math.max(0, n - 1));
								await sendMessage(msgText);
								return;
							}
							const isLastAssistant =
								messages.findLastIndex((m) => m.role === "assistant") ===
								msgIndex;
							if (isLastAssistant) {
								setToolCalls([]);
								await reload();
								return;
							}
							const lastUserIndex = messages.findLastIndex(
								(m, idx) => m.role === "user" && idx < msgIndex,
							);
							if (lastUserIndex === -1) return;
							const userMsg = messages[lastUserIndex];
							const userText = getTextContent(userMsg);
							if (isLoading) stop();
							const truncated = messages.slice(0, lastUserIndex);
							setMessages(truncated);
							setToolCalls([]);
							const full = await ensureFullHistory(truncated);
							const toSave = full
								.filter((m) => m.role === "user" || m.role === "assistant")
								.map(toTrainerMessage)
								.filter((m) => m.content);
							saveTrainerHistory(threadId, toSave).catch(console.error);
							setTotalServerMessages((n) => Math.max(0, n - 1));
							await sendMessage(userText);
						};

						return (
							<ChatMessageRow
								key={msg.id}
								msg={msg}
								msgIndex={msgIndex}
								isLastMsg={isLastMsg}
								isCurrentlyStreaming={isCurrentlyStreaming}
								onDelete={() => setConfirmDeleteMessageId(msg.id)}
								onRetry={handleRetry}
								toolCalls={callsForMsg}
							/>
						);
					})}

					{trailingToolCalls(messages, toolCalls).length > 0 && (
						<div className="ml-2 flex max-w-[calc(100%-1rem)] flex-col gap-1.5 sm:max-w-[72%]">
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
							<div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-4 py-3 text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400 [overflow-wrap:anywhere] sm:max-w-[80%]">
								Error: {error.message}
							</div>
						</div>
					)}

					<div ref={bottomRef} />
				</div>

				{(showScrollTop || showScrollBottom) && (
					<div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-5 flex flex-col gap-1.5 z-10">
						{showScrollTop && (
							<button
								type="button"
								onClick={scrollToTop}
								title="Scroll to top"
								className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] hover:border-[rgba(139,92,246,0.4)] text-[#7c6fa0] hover:text-[#c4b5fd] transition-all duration-200 cursor-pointer backdrop-blur-sm shadow-lg"
							>
								<ArrowUp className="w-3.5 h-3.5" />
							</button>
						)}
						{showScrollBottom && (
							<button
								type="button"
								onClick={scrollToBottom}
								title="Scroll to bottom"
								className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] hover:border-[rgba(139,92,246,0.4)] text-[#7c6fa0] hover:text-[#c4b5fd] transition-all duration-200 cursor-pointer backdrop-blur-sm shadow-lg"
							>
								<ArrowDown className="w-3.5 h-3.5" />
							</button>
						)}
					</div>
				)}
				{confirmDeleteMessageId &&
					createPortal(
						<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
							<div className="w-72 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 p-4">
								<p className="text-sm text-[#c4b5fd] mb-4">
									Are you sure you want to delete this message?
								</p>
								<div className="flex justify-end gap-2">
									<button
										type="button"
										onClick={() => setConfirmDeleteMessageId(null)}
										className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-[#c4b5fd] rounded-lg hover:bg-[#241e3d] transition-colors cursor-pointer"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={() => handleConfirmDelete(confirmDeleteMessageId)}
										className="px-3 py-1.5 text-xs text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors cursor-pointer"
									>
										Delete
									</button>
								</div>
							</div>
						</div>,
						document.body,
					)}
			</div>

			{/* Input bar */}
			<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-6 sm:pt-3 border-t border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
				<div className="flex flex-col gap-2 bg-[#1a1533]/60 border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2.5 sm:px-4 sm:py-3">
					<textarea
						ref={textareaRef}
						defaultValue={initialInput}
						onChange={(e) => {
							inputRef.current = e.target.value;
							const next = !!e.target.value.trim();
							if (next !== hasInput) setHasInput(next);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Ask your trainer..."
						rows={1}
						className="w-full resize-none bg-transparent text-base sm:text-sm text-[#f1f5f9] placeholder-[#4a4468] outline-none leading-relaxed"
						style={{ maxHeight: "200px", fieldSizing: "content" }}
					/>
					<div className="flex items-center gap-2">
						<ModelPicker
							currentModel={threadModel}
							defaultModel={defaultModel}
							availableModels={availableModels}
							onChange={onModelChange}
							favorites={favorites}
							onToggleFavorite={onToggleFavorite}
						/>
						<div className="ml-auto">
							{isLoading ? (
								<button
									type="button"
									onClick={stop}
									title="Stop generation"
									className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-400 transition-all duration-200 cursor-pointer shrink-0"
								>
									<Square className="w-3.5 h-3.5 fill-current" />
								</button>
							) : (
								<button
									type="button"
									onClick={handleSend}
									disabled={!hasInput}
									title="Send message"
									className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#8b5cf6]/20 hover:bg-[#8b5cf6]/30 border border-[#8b5cf6]/30 text-[#8b5cf6] transition-all duration-200 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
								>
									<Send className="w-3.5 h-3.5" />
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
