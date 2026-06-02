import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, X } from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";
import type { ModelEntry, TrainerThread } from "@fit-analyzer/shared";
import { fetchTrainerHistory } from "../lib/api";
import { toUIMessage } from "./trainer/trainerHelpers";
import {
	CompareColumn,
	type CompareColumnHandle,
	type CompareColumnStatus,
} from "./trainer/CompareColumn";
import { loadTrainerDraft } from "../lib/trainerStreamState";

export const MAX_COMPARE_THREADS = 4;
export const TRAINER_PAGE_SIZE = 20;

export interface TrainerCompareViewProps {
	pinnedThreads: TrainerThread[];
	defaultModel: string | null;
	availableModels: ModelEntry[];
	favorites: string[];
	onModelChange: (threadId: string, modelId: string) => void;
	onToggleFavorite: (modelId: string) => void;
	onUnpin: (threadId: string) => void;
}

type ColumnSnapshot = Record<
	string,
	{ isLoading: boolean; status: CompareColumnStatus }
>;

export function TrainerCompareView({
	pinnedThreads,
	defaultModel,
	availableModels,
	favorites,
	onModelChange,
	onToggleFavorite,
	onUnpin,
}: TrainerCompareViewProps) {
	type ColumnPayload = {
		messages: UIMessage[];
		nextCursor: string | null;
		hasMore: boolean;
		total: number;
	};
	const [columnInputs, setColumnInputs] = useState<
		Record<string, ColumnPayload>
	>({});
	const [columnStatus, setColumnStatus] = useState<ColumnSnapshot>({});
	const [hasInput, setHasInput] = useState(false);
	const refs = useRef<Record<string, CompareColumnHandle | null>>({});
	const [carouselIndex, setCarouselIndex] = useState(0);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [composerFocused, setComposerFocused] = useState(false);
	const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

	const setColumnRef = useCallback(
		(threadId: string) => (h: CompareColumnHandle | null) => {
			refs.current[threadId] = h;
		},
		[],
	);

	const columnRefsById = useMemo(() => {
		const map: Record<string, (h: CompareColumnHandle | null) => void> = {};
		for (const t of pinnedThreads) map[t.id] = setColumnRef(t.id);
		return map;
	}, [pinnedThreads, setColumnRef]);

	useEffect(() => {
		let cancelled = false;
		async function hydrate() {
			const entries = await Promise.all(
				pinnedThreads.map(async (thread) => {
					try {
						const history = await fetchTrainerHistory(thread.id, undefined, {
							limit: TRAINER_PAGE_SIZE,
						});
						const draft = loadTrainerDraft(thread.id);
						return [
							thread.id,
							{
								messages: draft ?? history.messages.map(toUIMessage),
								nextCursor: history.nextCursor,
								hasMore: history.hasMore,
								total: history.total,
							},
						] as const;
					} catch {
						return [
							thread.id,
							{
								messages: [] as UIMessage[],
								nextCursor: null,
								hasMore: false,
								total: 0,
							},
						] as const;
					}
				}),
			);
			if (cancelled) return;
			const next: Record<string, ColumnPayload> = {};
			for (const [id, payload] of entries) next[id] = payload;
			setColumnInputs(next);
		}
		hydrate();
		return () => {
			cancelled = true;
		};
	}, [pinnedThreads]);

	const handleStatusChange = useCallback(
		(
			threadId: string,
			next: { isLoading: boolean; status: CompareColumnStatus },
		) => {
			setColumnStatus((prev) => {
				const cur = prev[threadId];
				if (
					cur &&
					cur.isLoading === next.isLoading &&
					cur.status === next.status
				) {
					return prev;
				}
				return { ...prev, [threadId]: next };
			});
		},
		[],
	);

	const anyLoading = useMemo(
		() => pinnedThreads.some((t) => columnStatus[t.id]?.isLoading),
		[pinnedThreads, columnStatus],
	);

	const canSend = useMemo(() => {
		if (!hasInput) return false;
		if (anyLoading) return false;
		return true;
	}, [hasInput, anyLoading]);

	const broadcast = useCallback(async () => {
		const text = composerTextareaRef.current?.value.trim();
		if (!text || anyLoading) return;
		if (composerTextareaRef.current) composerTextareaRef.current.value = "";
		setHasInput(false);
		const handles = pinnedThreads
			.map((t) => refs.current[t.id])
			.filter((h): h is CompareColumnHandle => !!h);
		await Promise.all(handles.map((h) => h.sendMessage(text)));
	}, [anyLoading, pinnedThreads]);

	const stopAll = useCallback(() => {
		for (const t of pinnedThreads) refs.current[t.id]?.stop();
	}, [pinnedThreads]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void broadcast();
			}
		},
		[broadcast],
	);

	// Carousel: detect which panel is centered (mobile only)
	useEffect(() => {
		const el = scrollerRef.current;
		if (!el) return;
		const onScroll = () => {
			const idx = Math.round(el.scrollLeft / el.clientWidth);
			setCarouselIndex(Math.max(0, Math.min(idx, pinnedThreads.length - 1)));
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [pinnedThreads.length]);

	const goToPanel = useCallback((idx: number) => {
		const el = scrollerRef.current;
		if (!el) return;
		el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
		setCarouselIndex(idx);
	}, []);

	if (pinnedThreads.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center px-6 text-center text-[#94a3b8]">
				<div>
					<p className="text-sm">
						Pin threads from the sidebar to compare them.
					</p>
				</div>
			</div>
		);
	}

	const gridCols =
		pinnedThreads.length === 1
			? "grid-cols-1"
			: pinnedThreads.length === 2
				? "lg:grid-cols-2"
				: pinnedThreads.length === 3
					? "lg:grid-cols-3"
					: "lg:grid-cols-2 xl:grid-cols-4";

	return (
		<div className="flex-1 flex flex-col min-h-0 min-w-0">
			{/* Header strip */}
			<div className="flex items-center gap-2 px-3 py-2 sm:px-6 sm:py-3 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
				<div className="flex flex-col min-w-0">
					<span className="text-sm font-semibold text-[#f1f5f9]">
						Compare {pinnedThreads.length} thread
						{pinnedThreads.length === 1 ? "" : "s"}
					</span>
					<span className="text-[11px] text-[#94a3b8]">
						{anyLoading
							? "Streaming…"
							: "Send to all. Each thread keeps its own model and history."}
					</span>
				</div>
			</div>

			{/* Column area */}
			<div className="flex-1 min-h-0 relative">
				{/* Mobile carousel */}
				<div
					ref={scrollerRef}
					className="lg:hidden absolute inset-0 overflow-x-auto snap-x snap-mandatory flex"
					style={{ scrollbarWidth: "none" }}
				>
					{pinnedThreads.map((thread) => {
						const payload = columnInputs[thread.id];
						return (
							<div
								key={thread.id}
								className="snap-start shrink-0 w-full h-full p-2"
							>
								<CompareColumn
									ref={columnRefsById[thread.id]}
									thread={thread}
									initialMessages={payload?.messages ?? []}
									initialNextCursor={payload?.nextCursor ?? null}
									initialHasMore={payload?.hasMore ?? false}
									initialTotal={payload?.total ?? 0}
									defaultModel={defaultModel}
									availableModels={availableModels}
									favorites={favorites}
									onModelChange={(modelId) => onModelChange(thread.id, modelId)}
									onToggleFavorite={onToggleFavorite}
									onUnpin={() => onUnpin(thread.id)}
									onStatusChange={(s) => handleStatusChange(thread.id, s)}
								/>
							</div>
						);
					})}
				</div>

				{/* Desktop grid */}
				<div
					className={`hidden lg:grid absolute inset-0 gap-2 p-2 ${gridCols}`}
				>
					{pinnedThreads.map((thread) => {
						const payload = columnInputs[thread.id];
						return (
							<div key={thread.id} className="min-h-0 min-w-0">
								<CompareColumn
									ref={columnRefsById[thread.id]}
									thread={thread}
									initialMessages={payload?.messages ?? []}
									initialNextCursor={payload?.nextCursor ?? null}
									initialHasMore={payload?.hasMore ?? false}
									initialTotal={payload?.total ?? 0}
									defaultModel={defaultModel}
									availableModels={availableModels}
									favorites={favorites}
									onModelChange={(modelId) => onModelChange(thread.id, modelId)}
									onToggleFavorite={onToggleFavorite}
									onUnpin={() => onUnpin(thread.id)}
									onStatusChange={(s) => handleStatusChange(thread.id, s)}
								/>
							</div>
						);
					})}
				</div>
			</div>

			{/* Mobile page dots */}
			{pinnedThreads.length > 1 && (
				<div className="lg:hidden flex items-center justify-center gap-2 py-1.5 bg-[#0f0b1a] border-t border-[rgba(139,92,246,0.08)]">
					{pinnedThreads.map((thread, idx) => {
						const isActive = idx === carouselIndex;
						const loading = columnStatus[thread.id]?.isLoading;
						return (
							<button
								key={thread.id}
								type="button"
								onClick={() => goToPanel(idx)}
								className={`relative h-2.5 w-2.5 rounded-full transition-all cursor-pointer ${
									isActive
										? "bg-[#8b5cf6] scale-110"
										: "bg-[#4a4468] hover:bg-[#7c6fa0]"
								}`}
								title={thread.name}
								aria-label={`Show ${thread.name}`}
							>
								{loading && (
									<span className="absolute inset-0 rounded-full animate-ping bg-[#8b5cf6]/60" />
								)}
							</button>
						);
					})}
				</div>
			)}

			{/* Master composer */}
			<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-6 sm:pt-3 border-t border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
				<div className="flex flex-col gap-2 bg-[#1a1533]/60 border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2.5 sm:px-4 sm:py-3">
					<textarea
						ref={composerTextareaRef}
						defaultValue=""
						onChange={(e) => {
							const next = !!e.target.value.trim();
							if (next !== hasInput) setHasInput(next);
						}}
						onFocus={() => setComposerFocused(true)}
						onBlur={() => setComposerFocused(false)}
						onKeyDown={handleKeyDown}
						placeholder={
							anyLoading
								? "Wait for the current responses…"
								: `Send to ${pinnedThreads.length} thread${pinnedThreads.length === 1 ? "" : "s"}…`
						}
						rows={1}
						className="w-full resize-none bg-transparent text-base sm:text-sm text-[#f1f5f9] placeholder-[#4a4468] outline-none leading-relaxed"
						style={{ maxHeight: "200px", fieldSizing: "content" }}
					/>
					<div className="flex items-center gap-2">
						<div className="flex flex-wrap gap-1.5 min-w-0">
							{pinnedThreads.map((t) => (
								<span
									key={t.id}
									className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[#c4b5fd] bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 rounded-md"
								>
									<span className="truncate max-w-[8rem]">{t.name}</span>
									{columnStatus[t.id]?.isLoading && (
										<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-pulse" />
									)}
									<button
										type="button"
										onClick={() => onUnpin(t.id)}
										className="text-[#7c6fa0] hover:text-rose-400 cursor-pointer"
										title={`Unpin ${t.name}`}
										aria-label={`Unpin ${t.name}`}
									>
										<X className="w-3 h-3" />
									</button>
								</span>
							))}
						</div>
						<div className="ml-auto flex items-center gap-1.5">
							{anyLoading && (
								<button
									type="button"
									onClick={stopAll}
									title="Stop all"
									className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-all cursor-pointer"
								>
									<Square className="w-3 h-3 fill-current" />
									<span className="hidden sm:inline">Stop all</span>
								</button>
							)}
							<button
								type="button"
								onClick={() => void broadcast()}
								disabled={!canSend}
								title={composerFocused ? "Send to all" : ""}
								className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#8b5cf6] bg-[#8b5cf6]/20 hover:bg-[#8b5cf6]/30 border border-[#8b5cf6]/30 rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<Send className="w-3.5 h-3.5" />
								<span>Send to all ({pinnedThreads.length})</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
