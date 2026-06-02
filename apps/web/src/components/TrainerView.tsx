import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerThread } from "@fit-analyzer/shared";
import { AVAILABLE_MODELS, type ModelEntry } from "@fit-analyzer/shared";
import {
	compactTrainerHistory,
	createThread,
	deleteThread,
	exportTrainerThread,
	fetchAvailableModels,
	fetchThreads,
	fetchTrainerHistory,
	fetchUserSettings,
	forkThread,
	importTrainerChat,
	renameThread,
	updateCompareSettings,
	updateFavoriteModels,
	updateThreadModel,
} from "../lib/api";
import { loadTrainerDraft } from "../lib/trainerStreamState";
import { ThreadSidebar } from "./trainer/ThreadSidebar";
import { TrainerChat } from "./trainer/TrainerChat";
import { CoachOnboarding } from "./trainer/CoachOnboarding";
import { TrainerCompareView, MAX_COMPARE_THREADS } from "./TrainerCompareView";
import { toUIMessage } from "./trainer/trainerHelpers";

interface TrainerViewProps {
	initialMessage: string;
	activityId: string;
	onBack: () => void;
}

export function TrainerView({
	initialMessage,
	activityId,
	onBack,
}: TrainerViewProps) {
	const [threads, setThreads] = useState<TrainerThread[]>([]);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
		null,
	);
	const [chatKey, setChatKey] = useState(0);
	const [threadsLoading, setThreadsLoading] = useState(true);
	const [threadsOpen, setThreadsOpen] = useState(false);
	const [currentInitialInput, setCurrentInitialInput] =
		useState(initialMessage);
	const [defaultModel, setDefaultModel] = useState<string | null>(null);
	const [availableModels, setAvailableModels] = useState<ModelEntry[]>([
		...AVAILABLE_MODELS,
	]);
	const [favorites, setFavorites] = useState<string[]>([]);
	const [autoSend, setAutoSend] = useState(false);
	const [showOnboarding, setShowOnboarding] = useState(false);
	const [compareMode, setCompareMode] = useState(false);
	const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>([]);
	const settingsHydrated = useRef(false);
	const initialized = useRef(false);
	const threadCache = useRef<
		Record<
			string,
			{
				messages: UIMessage[];
				nextCursor: string | null;
				hasMore: boolean;
				total: number;
				stale?: boolean;
			}
		>
	>({});

	// Load threads for this activity
	const loadThreads = useCallback(async () => {
		setThreadsLoading(true);
		try {
			const list = await fetchThreads(activityId);
			setThreads(list);
			if (!initialized.current && list.length > 0) {
				initialized.current = true;
				// Auto-select the most recently updated thread
				const latest = list.reduce((a, b) =>
					a.updatedAt > b.updatedAt ? a : b,
				);
				setActiveThreadId(latest.id);
			}
			setPinnedThreadIds((prev) => {
				const validIds = list.map((t) => t.id);
				const next = prev.filter((id) => validIds.includes(id));
				if (
					next.length === prev.length &&
					next.every((id, i) => id === prev[i])
				) {
					return prev;
				}
				if (settingsHydrated.current) {
					updateCompareSettings({ compareThreadIds: next }).catch(
						console.error,
					);
				}
				return next;
			});
		} catch {
			setThreads([]);
		} finally {
			setThreadsLoading(false);
		}
	}, [activityId]);

	useEffect(() => {
		loadThreads();
	}, [loadThreads]);

	useEffect(() => {
		fetchUserSettings()
			.then((data) => {
				const id = data.coachModel?.coachModel;
				if (id) setDefaultModel(id);
				if (Array.isArray(data.favoriteModels)) {
					setFavorites(data.favoriteModels);
				}
				if (data.compare) {
					setCompareMode(!!data.compare.compareEnabled);
					if (Array.isArray(data.compare.compareThreadIds)) {
						setPinnedThreadIds(data.compare.compareThreadIds);
					}
				}
				settingsHydrated.current = true;
			})
			.catch(() => {
				/* ignore */
			});
	}, []);

	useEffect(() => {
		fetchAvailableModels()
			.then((models) => setAvailableModels(models))
			.catch(() => {
				/* ignore */
			});
	}, []);

	// When active thread changes, load its messages (background refresh if cached)
	useEffect(() => {
		if (!activeThreadId) {
			setInitialMessages(null);
			return;
		}
		const cached = threadCache.current[activeThreadId];
		// If we already have a fresh cache for this thread, skip the refetch —
		// the optimistic `setInitialMessages` in `handleSelectThread` is enough.
		if (cached?.messages && !cached.stale) {
			return;
		}
		const abortController = new AbortController();
		fetchTrainerHistory(activeThreadId, abortController.signal, {
			limit: 20,
		})
			.then((h) => {
				if (abortController.signal.aborted) return;
				const draft = loadTrainerDraft(activeThreadId);
				const messages = draft ?? h.messages.map(toUIMessage);
				threadCache.current[activeThreadId] = {
					messages,
					nextCursor: h.nextCursor,
					hasMore: h.hasMore,
					total: h.total,
				};
				setInitialMessages(messages);
			})
			.catch(() => {
				if (abortController.signal.aborted) return;
				setInitialMessages([]);
			});
		return () => abortController.abort();
	}, [activeThreadId]);

	const handleSelectThread = useCallback(
		(id: string) => {
			if (id === activeThreadId) return;
			const cached = threadCache.current[id];
			if (cached?.messages) {
				setInitialMessages(cached.messages);
			} else {
				setInitialMessages(null);
			}
			setActiveThreadId(id);
			setShowOnboarding(false);
			setCurrentInitialInput("");
		},
		[activeThreadId],
	);

	const activeThread = threads.find((t) => t.id === activeThreadId);

	const handleCreateThread = useCallback(async () => {
		setShowOnboarding(true);
	}, []);

	const handleRenameThread = useCallback(
		async (threadId: string, name: string) => {
			await renameThread(threadId, name);
			setThreads((prev) =>
				prev.map((t) => (t.id === threadId ? { ...t, name } : t)),
			);
		},
		[],
	);

	const handleModelChange = useCallback(
		async (threadId: string, modelId: string) => {
			await updateThreadModel(threadId, modelId);
			setThreads((prev) =>
				prev.map((t) =>
					t.id === threadId ? { ...t, coachModel: modelId } : t,
				),
			);
		},
		[],
	);

	const handleToggleFavorite = useCallback((modelId: string) => {
		setFavorites((prev) => {
			const next = prev.includes(modelId)
				? prev.filter((id) => id !== modelId)
				: [...prev, modelId];
			updateFavoriteModels(next).catch(() => {
				/* ignore */
			});
			return next;
		});
	}, []);

	const handleDeleteThread = useCallback(
		async (threadId: string) => {
			await deleteThread(threadId);
			setThreads((prev) => {
				const next = prev.filter((t) => t.id !== threadId);
				if (activeThreadId === threadId) {
					setActiveThreadId(next.length > 0 ? next[next.length - 1].id : null);
				}
				return next;
			});
			setPinnedThreadIds((prev) => {
				if (!prev.includes(threadId)) return prev;
				const nextPinned = prev.filter((id) => id !== threadId);
				updateCompareSettings({ compareThreadIds: nextPinned }).catch(
					console.error,
				);
				return nextPinned;
			});
		},
		[activeThreadId],
	);

	const handleTogglePin = useCallback((threadId: string) => {
		setPinnedThreadIds((prev) => {
			if (prev.includes(threadId)) {
				const next = prev.filter((id) => id !== threadId);
				updateCompareSettings({ compareThreadIds: next }).catch(console.error);
				return next;
			}
			if (prev.length >= MAX_COMPARE_THREADS) return prev;
			const next = [...prev, threadId];
			updateCompareSettings({ compareThreadIds: next }).catch(console.error);
			return next;
		});
	}, []);

	const handleToggleCompare = useCallback(() => {
		setCompareMode((prev) => {
			const next = !prev;
			updateCompareSettings({ compareEnabled: next }).catch(console.error);
			return next;
		});
	}, []);

	const handleForkThread = useCallback(async (threadId: string) => {
		const newThread = await forkThread(threadId);
		setThreads((prev) => [...prev, newThread]);
		setActiveThreadId(newThread.id);
	}, []);

	const handleImported = useCallback(() => {
		if (!activeThreadId) return;
		setInitialMessages(null);
		fetchTrainerHistory(activeThreadId, undefined, { limit: 20 })
			.then((h) => {
				const draft = loadTrainerDraft(activeThreadId);
				const messages = draft ?? h.messages.map(toUIMessage);
				threadCache.current[activeThreadId] = {
					messages,
					nextCursor: h.nextCursor,
					hasMore: h.hasMore,
					total: h.total,
				};
				setInitialMessages(messages);
				setChatKey((k) => k + 1);
			})
			.catch(() => setInitialMessages([]));
	}, [activeThreadId]);

	const handleCompactThread = useCallback(async (threadId: string) => {
		const result = await compactTrainerHistory(threadId);
		if (result.compacted && result.thread) {
			setThreads((prev) => [...prev, result.thread]);
			setActiveThreadId(result.thread.id);
		}
	}, []);

	const handleExportThread = useCallback(async (threadId: string) => {
		const { filename, markdown } = await exportTrainerThread(threadId);
		const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.rel = "noopener";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}, []);

	const handleOnboardingImport = useCallback(
		async (file: File) => {
			const { threadId: importedThreadId } = await importTrainerChat(file);
			const list = await fetchThreads(activityId);
			setThreads(list);
			initialized.current = true;
			setAutoSend(false);
			setCurrentInitialInput("");
			setActiveThreadId(importedThreadId);
			setShowOnboarding(false);
			setChatKey((k) => k + 1);
		},
		[activityId],
	);

	// ── render ──────────────────────────────────────────────────────────────────

	const pinnedThreads = useMemo(
		() =>
			pinnedThreadIds
				.map((id) => threads.find((t) => t.id === id))
				.filter((t): t is TrainerThread => !!t),
		[pinnedThreadIds, threads],
	);

	const chatArea = (() => {
		if (threadsLoading) {
			return (
				<div className="flex-1 flex items-center justify-center">
					<span className="flex gap-1.5">
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
					</span>
				</div>
			);
		}

		if (compareMode && pinnedThreads.length > 0) {
			return (
				<TrainerCompareView
					pinnedThreads={pinnedThreads}
					defaultModel={defaultModel}
					availableModels={availableModels}
					favorites={favorites}
					onModelChange={handleModelChange}
					onToggleFavorite={handleToggleFavorite}
					onUnpin={handleTogglePin}
				/>
			);
		}

		if (activeThreadId === null || showOnboarding) {
			return (
				<CoachOnboarding
					onComplete={async (prompt, coachModel) => {
						const thread = await createThread(
							activityId,
							"Cycling Coach Plan",
							coachModel ?? undefined,
						);
						setThreads((prev) => [...prev, thread]);
						setActiveThreadId(thread.id);
						setCurrentInitialInput(prompt);
						setAutoSend(true);
						setShowOnboarding(false);
						setChatKey((k) => k + 1);
					}}
					onImport={handleOnboardingImport}
					availableModels={availableModels}
					defaultModel={defaultModel}
					favorites={favorites}
					onToggleFavorite={handleToggleFavorite}
				/>
			);
		}

		if (initialMessages === null) {
			return (
				<div className="flex-1 flex items-center justify-center">
					<span className="flex gap-1.5">
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
						<span className="w-2 h-2 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
					</span>
				</div>
			);
		}

		return (
			<TrainerChat
				key={`${activeThreadId}-${chatKey}`}
				threadId={activeThreadId}
				activityId={activityId}
				initialMessages={initialMessages}
				initialNextCursor={
					threadCache.current[activeThreadId]?.nextCursor ?? null
				}
				initialHasMore={threadCache.current[activeThreadId]?.hasMore ?? false}
				initialTotal={threadCache.current[activeThreadId]?.total ?? 0}
				initialInput={currentInitialInput}
				autoSend={autoSend}
				onBack={onBack}
				onOpenThreads={() => setThreadsOpen(true)}
				onImported={handleImported}
				threadModel={activeThread?.coachModel ?? null}
				defaultModel={defaultModel}
				availableModels={availableModels}
				onModelChange={(modelId) => handleModelChange(activeThreadId, modelId)}
				favorites={favorites}
				onToggleFavorite={handleToggleFavorite}
			/>
		);
	})();

	return (
		<div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden md:flex-row">
			<ThreadSidebar
				threads={threads}
				activeThreadId={activeThreadId}
				onSelect={handleSelectThread}
				onCreate={handleCreateThread}
				onRename={handleRenameThread}
				onDelete={handleDeleteThread}
				onFork={handleForkThread}
				onCompact={handleCompactThread}
				onExport={handleExportThread}
				open={threadsOpen}
				onClose={() => setThreadsOpen(false)}
				compareMode={compareMode}
				pinnedThreadIds={pinnedThreadIds}
				maxPinned={MAX_COMPARE_THREADS}
				onTogglePin={handleTogglePin}
				onToggleCompare={threads.length >= 2 ? handleToggleCompare : undefined}
			/>
			{threadsOpen && (
				<button
					type="button"
					aria-label="Close threads"
					onClick={() => setThreadsOpen(false)}
					className="fixed inset-0 z-50 bg-black/50 md:hidden"
				/>
			)}
			{chatArea}
		</div>
	);
}
