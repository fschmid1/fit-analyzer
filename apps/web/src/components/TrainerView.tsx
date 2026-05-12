import { useEffect, useRef, useState, useCallback } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerThread } from "@fit-analyzer/shared";
import { AVAILABLE_MODELS, type ModelEntry } from "@fit-analyzer/shared";
import {
	compactTrainerHistory,
	createThread,
	deleteThread,
	fetchAvailableModels,
	fetchThreads,
	fetchTrainerHistory,
	fetchUserSettings,
	forkThread,
	renameThread,
	updateThreadModel,
} from "../lib/api";
import {
	loadTrainerDraft,
} from "../lib/trainerStreamState";
import { ThreadSidebar } from "./trainer/ThreadSidebar";
import { TrainerChat } from "./trainer/TrainerChat";
import { toUIMessage } from "./trainer/trainerHelpers";
import { Plus } from "lucide-react";

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
	const [availableModels, setAvailableModels] = useState<ModelEntry[]>([...AVAILABLE_MODELS]);
	const initialized = useRef(false);

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

	// When active thread changes, load its messages
	useEffect(() => {
		if (!activeThreadId) {
			setInitialMessages(null);
			return;
		}
		setInitialMessages(null);
		fetchTrainerHistory(activeThreadId)
			.then((h) => {
				const draft = loadTrainerDraft(activeThreadId);
				setInitialMessages(draft ?? h.messages.map(toUIMessage));
			})
			.catch(() => setInitialMessages([]));
	}, [activeThreadId]);

	const handleSelectThread = useCallback((id: string) => {
		setActiveThreadId(id);
		setCurrentInitialInput(""); // only pre-fill on first open
	}, []);

	const activeThread = threads.find((t) => t.id === activeThreadId);

	const handleCreateThread = useCallback(async () => {
		const name = `Thread ${threads.length + 1}`;
		const thread = await createThread(activityId, name);
		setThreads((prev) => [...prev, thread]);
		setActiveThreadId(thread.id);
		setCurrentInitialInput("");
	}, [activityId, threads.length]);

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
		},
		[activeThreadId],
	);

	const handleForkThread = useCallback(async (threadId: string) => {
		const newThread = await forkThread(threadId);
		setThreads((prev) => [...prev, newThread]);
		setActiveThreadId(newThread.id);
	}, []);

	const handleImported = useCallback(() => {
		if (!activeThreadId) return;
		setInitialMessages(null);
		fetchTrainerHistory(activeThreadId)
			.then((h) => {
				const draft = loadTrainerDraft(activeThreadId);
				setInitialMessages(draft ?? h.messages.map(toUIMessage));
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

	// ── render ──────────────────────────────────────────────────────────────────

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

		if (activeThreadId === null) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8 opacity-60">
					<div className="w-12 h-12 rounded-lg bg-[#8b5cf6]/20 flex items-center justify-center">
						<Plus className="w-5 h-5 text-[#8b5cf6]" />
					</div>
					<p className="text-sm text-[#94a3b8]">No threads yet.</p>
					<button
						type="button"
						onClick={handleCreateThread}
						className="px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-lg transition-all duration-200 cursor-pointer"
					>
						Create first thread
					</button>
				</div>
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
				initialInput={currentInitialInput}
				onBack={onBack}
				onOpenThreads={() => setThreadsOpen(true)}
				onImported={handleImported}
				threadModel={activeThread?.coachModel ?? null}
				defaultModel={defaultModel}
				availableModels={availableModels}
				onModelChange={(modelId) => handleModelChange(activeThreadId, modelId)}
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
				open={threadsOpen}
				onClose={() => setThreadsOpen(false)}
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
