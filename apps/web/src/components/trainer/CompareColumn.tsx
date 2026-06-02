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
import { ArrowDown, ArrowUp, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	AVAILABLE_MODELS,
	getCoachModelDisplayName,
	getModelProvider,
	type ModelEntry,
	type TrainerThread,
} from "@fit-analyzer/shared";
import { createTrainerStreamConnection } from "../../lib/trainerStreamConnection";
import {
	clearActiveTrainerStream,
	clearTrainerDraft,
	loadActiveTrainerStream,
} from "../../lib/trainerStreamState";
import { mdComponents } from "./markdownComponents";
import { DotsLoader } from "./DotsLoader";
import { ThinkingBlock } from "./ThinkingBlock";
import { ModelPicker } from "./ModelPicker";
import {
	applyResumedChunk,
	formatTime,
	getTextContent,
	getThinkingContent,
	stripTrailingAssistant,
	streamResumedChat,
} from "./trainerHelpers";
import {
	persistMessagesNow,
	useTrainerHistoryPersist,
} from "./useTrainerHistoryPersist";

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
	const connectionRef = useRef(createTrainerStreamConnection(thread.id));
	const { messages, sendMessage, status, isLoading, stop, error, setMessages } =
		useChat({
			connection: connectionRef.current,
			initialMessages,
			body: { threadId: thread.id },
		});

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

	useEffect(() => {
		const activeStream = loadActiveTrainerStream(thread.id);
		let baseMessages = stripTrailingAssistant(initialMessages);
		setMessages(baseMessages);
		if (!activeStream) return;

		const abortController = new AbortController();

		streamResumedChat(
			activeStream.streamId,
			(chunk) => {
				baseMessages = applyResumedChunk(baseMessages, chunk);
				setMessages(baseMessages);

				if (chunk.type === "RUN_FINISHED" || chunk.type === "RUN_ERROR") {
					clearActiveTrainerStream(thread.id);
					clearTrainerDraft(thread.id);
					persistMessagesNow(thread.id, baseMessages);
				}
			},
			abortController.signal,
		).catch((resumeError) => {
			if (resumeError instanceof Error && resumeError.name === "AbortError")
				return;
			console.error("Failed to resume trainer stream:", resumeError);
		});

		return () => abortController.abort();
	}, [initialMessages, setMessages, thread.id]);

	useTrainerHistoryPersist(thread.id, messages, status);

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
							`${coachModelName} · ${providerLabel}`}
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
					onScroll={updateScrollButtons}
					className="absolute inset-0 overflow-y-auto px-3 py-4 space-y-4"
				>
					{messages.length === 0 && (
						<div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-50">
							<div className="w-10 h-10 rounded-lg bg-[#8b5cf6]/20 flex items-center justify-center">
								<span className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
							</div>
							<p className="text-xs text-[#94a3b8]">
								Send a message to start comparing.
							</p>
						</div>
					)}

					{messages.map((msg, msgIndex) => {
						const isUser = msg.role === "user";
						const isLastMsg = msg.id === lastMessageId;
						const isCurrentlyStreaming = isLastMsg && status === "streaming";

						if (isUser) {
							const text = getTextContent(msg);
							if (!text) return null;
							return (
								<div key={msg.id} className="flex flex-col items-end gap-1">
									<div className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap [overflow-wrap:anywhere]">
										{text}
									</div>
									<span className="text-[10px] text-[#4a4468]">
										{formatTime(msg.createdAt)}
									</span>
								</div>
							);
						}

						const thinkingContent = getThinkingContent(msg);
						const textContent = getTextContent(msg);
						const isThinkingPhase =
							isCurrentlyStreaming && !!thinkingContent && !textContent;

						return (
							<div key={msg.id} className="flex flex-col items-start gap-1">
								<div className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd] [overflow-wrap:anywhere]">
									{thinkingContent && (
										<ThinkingBlock
											content={thinkingContent}
											isStreaming={isThinkingPhase}
										/>
									)}
									{textContent ? (
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											components={mdComponents}
										>
											{textContent}
										</ReactMarkdown>
									) : isCurrentlyStreaming && !thinkingContent ? (
										<DotsLoader />
									) : null}
									{isCurrentlyStreaming && textContent && (
										<span className="inline-block w-0.5 h-4 bg-[#8b5cf6] animate-pulse ml-0.5 align-middle" />
									)}
								</div>
								{!isCurrentlyStreaming && textContent && (
									<span className="text-[10px] text-[#4a4468]">
										{formatTime(msg.createdAt)}
									</span>
								)}
							</div>
						);
					})}

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
