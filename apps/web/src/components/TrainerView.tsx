import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@tanstack/ai-react";
import { useDrag } from "@use-gesture/react";
import type { StreamChunk } from "@tanstack/ai";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Clipboard,
	GitFork,
	Menu,
	Minimize2,
	MoreVertical,
	Pencil,
	Plus,
	RefreshCw,
	Send,
	Square,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerMessage, TrainerThread } from "@fit-analyzer/shared";
import {
	AVAILABLE_MODELS,
	getCoachModelDisplayName,
	getModelProvider,
	type ModelEntry,
} from "@fit-analyzer/shared";
import {
	compactTrainerHistory,
	createThread,
	deleteThread,
	fetchAvailableModels,
	fetchThreads,
	fetchTrainerHistory,
	fetchUserSettings,
	forkThread,
	importTrainerChat,
	renameThread,
	saveTrainerHistory,
	updateThreadModel,
} from "../lib/api";
import { createTrainerStreamConnection } from "../lib/trainerStreamConnection";
import {
	clearActiveTrainerStream,
	clearTrainerDraft,
	loadActiveTrainerStream,
	loadTrainerDraft,
	saveTrainerDraft,
} from "../lib/trainerStreamState";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TrainerViewProps {
	initialMessage: string;
	activityId: string;
	onBack: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getTextContent(msg: UIMessage): string {
	return msg.parts
		.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
		.map((p) => p.content)
		.join("");
}

function getThinkingContent(msg: UIMessage): string {
	return msg.parts
		.filter(
			(p): p is Extract<typeof p, { type: "thinking" }> =>
				p.type === "thinking",
		)
		.map((p) => p.content)
		.join("");
}

function toUIMessage(m: TrainerMessage): UIMessage {
	return {
		id: m.id,
		role: m.role,
		parts: [{ type: "text" as const, content: m.content }],
		createdAt: new Date(m.createdAt),
	};
}

function toTrainerMessage(m: UIMessage): TrainerMessage {
	return {
		id: m.id,
		role: m.role as "user" | "assistant",
		content: getTextContent(m),
		createdAt: (m.createdAt ?? new Date()).toISOString(),
	};
}

function stripTrailingAssistant(messages: UIMessage[]): UIMessage[] {
	if (messages.length === 0) return messages;
	const lastMessage = messages[messages.length - 1];
	if (lastMessage.role !== "assistant") return messages;
	return messages.slice(0, -1);
}

function ensureAssistantMessage(
	messages: UIMessage[],
	messageId?: string,
): UIMessage[] {
	const lastMessage = messages[messages.length - 1];
	if (lastMessage?.role === "assistant") {
		if (messageId && lastMessage.id !== messageId) {
			return [...messages.slice(0, -1), { ...lastMessage, id: messageId }];
		}
		return messages;
	}

	return [
		...messages,
		{
			id: messageId ?? crypto.randomUUID(),
			role: "assistant",
			parts: [],
			createdAt: new Date(),
		},
	];
}

function applyResumedChunk(
	messages: UIMessage[],
	chunk: StreamChunk,
): UIMessage[] {
	if (
		chunk.type === "RUN_STARTED" ||
		chunk.type === "RUN_FINISHED" ||
		chunk.type === "RUN_ERROR"
	) {
		return messages;
	}

	if (chunk.type === "STEP_STARTED") {
		return ensureAssistantMessage(messages);
	}

	if (chunk.type === "STEP_FINISHED") {
		const nextMessages = ensureAssistantMessage(messages);
		const assistant = nextMessages[nextMessages.length - 1];
		if (!assistant || assistant.role !== "assistant") return nextMessages;

		const existingThinking = assistant.parts.find(
			(part): part is Extract<typeof part, { type: "thinking" }> =>
				part.type === "thinking",
		);
		const nextThinking =
			chunk.content ?? `${existingThinking?.content ?? ""}${chunk.delta ?? ""}`;
		const nextParts = assistant.parts.some((part) => part.type === "thinking")
			? assistant.parts.map((part) =>
					part.type === "thinking" ? { ...part, content: nextThinking } : part,
				)
			: [
					...assistant.parts,
					{ type: "thinking" as const, content: nextThinking },
				];

		return [...nextMessages.slice(0, -1), { ...assistant, parts: nextParts }];
	}

	if (chunk.type === "TEXT_MESSAGE_START") {
		return ensureAssistantMessage(messages, chunk.messageId);
	}

	if (chunk.type === "TEXT_MESSAGE_CONTENT") {
		const nextMessages = ensureAssistantMessage(messages, chunk.messageId);
		const assistant = nextMessages[nextMessages.length - 1];
		if (!assistant || assistant.role !== "assistant") return nextMessages;

		const existingText = assistant.parts.find(
			(part): part is Extract<typeof part, { type: "text" }> =>
				part.type === "text",
		);
		const nextText =
			chunk.content ?? `${existingText?.content ?? ""}${chunk.delta ?? ""}`;
		const nextParts = assistant.parts.some((part) => part.type === "text")
			? assistant.parts.map((part) =>
					part.type === "text" ? { ...part, content: nextText } : part,
				)
			: [...assistant.parts, { type: "text" as const, content: nextText }];

		return [
			...nextMessages.slice(0, -1),
			{ ...assistant, id: chunk.messageId, parts: nextParts },
		];
	}

	return messages;
}

async function streamResumedChat(
	streamId: string,
	onChunk: (chunk: StreamChunk) => void,
	signal: AbortSignal,
) {
	const response = await fetch(`/api/trainer/chat/${streamId}`, {
		method: "GET",
		credentials: "same-origin",
		signal,
	});

	if (!response.ok) {
		throw new Error(`Resume failed: ${response.status} ${response.statusText}`);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("Resume response body is not readable");

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const events = buffer.split("\n\n");
		buffer = events.pop() ?? "";

		for (const event of events) {
			const line = event
				.split("\n")
				.find((candidate) => candidate.startsWith("data: "));
			if (!line) continue;
			const data = line.slice(6);
			if (data === "[DONE]") return;
			onChunk(JSON.parse(data) as StreamChunk);
		}
	}
}

function formatTime(date: Date | undefined): string {
	if (!date) return "";
	const now = new Date();
	const isToday =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const time = date.toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	if (isToday) return time;
	return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

// ─── markdown components (unchanged) ─────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
	p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
	h1: ({ children }) => (
		<h1 className="text-lg font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }) => (
		<h2 className="text-base font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }) => (
		<h3 className="text-base font-semibold text-[#e2d9f3] mt-2 mb-1 first:mt-0">
			{children}
		</h3>
	),
	ul: ({ children }) => (
		<ul className="list-disc list-outside pl-4 mb-2 space-y-0.5">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5">
			{children}
		</ol>
	),
	li: ({ children }) => <li className="leading-relaxed">{children}</li>,
	strong: ({ children }) => (
		<strong className="font-semibold text-[#e2d9f3]">{children}</strong>
	),
	em: ({ children }) => <em className="italic text-[#d4b8fd]">{children}</em>,
	code: ({ children, className }) => {
		const isBlock = className?.includes("language-");
		return isBlock ? (
			<code className="block bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2 my-2 text-sm font-mono text-[#a78bfa] overflow-x-auto whitespace-pre">
				{children}
			</code>
		) : (
			<code className="bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded px-1.5 py-0.5 text-sm font-mono text-[#a78bfa]">
				{children}
			</code>
		);
	},
	pre: ({ children }) => <pre className="my-2">{children}</pre>,
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-[#8b5cf6]/50 pl-3 my-2 text-[#a78bfa] italic">
			{children}
		</blockquote>
	),
	a: ({ href, children }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-[#a78bfa] underline underline-offset-2 hover:text-[#c4b5fd] transition-colors"
		>
			{children}
		</a>
	),
	hr: () => <hr className="border-[rgba(139,92,246,0.2)] my-3" />,
	table: ({ children }) => (
		<div className="max-w-full overflow-x-auto my-2">
			<table className="w-full text-sm border-collapse">{children}</table>
		</div>
	),
	thead: ({ children }) => (
		<thead className="bg-[#8b5cf6]/10">{children}</thead>
	),
	th: ({ children }) => (
		<th className="border border-[rgba(139,92,246,0.2)] px-2 py-1.5 text-left font-semibold text-[#e2d9f3]">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="border border-[rgba(139,92,246,0.15)] px-2 py-1.5 text-[#c4b5fd]">
			{children}
		</td>
	),
	tr: ({ children }) => <tr className="even:bg-[#8b5cf6]/5">{children}</tr>,
};

// ─── small UI pieces ──────────────────────────────────────────────────────────

function DotsLoader() {
	return (
		<span className="flex gap-1 items-center h-5">
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
			<span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
		</span>
	);
}

function ThinkingBlock({
	content,
	isStreaming,
}: { content: string; isStreaming: boolean }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (isStreaming) setOpen(true);
		else setOpen(false);
	}, [isStreaming]);
	return (
		<div className="mb-3 rounded-lg border border-[rgba(139,92,246,0.15)] bg-[#0f0b1a]/60 overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#7c6fa0] hover:text-[#a78bfa] transition-colors cursor-pointer"
			>
				<Brain className="w-3.5 h-3.5 shrink-0" />
				{isStreaming ? (
					<span className="flex items-center gap-2">
						Thinking
						<DotsLoader />
					</span>
				) : (
					<span>Reasoning</span>
				)}
				<span className="ml-auto">
					{open ? (
						<ChevronDown className="w-3.5 h-3.5" />
					) : (
						<ChevronRight className="w-3.5 h-3.5" />
					)}
				</span>
			</button>
			{open && content && (
				<div className="px-3 pb-3 text-xs text-[#6b5e8a] font-mono leading-relaxed whitespace-pre-wrap border-t border-[rgba(139,92,246,0.1)] pt-2 max-h-64 overflow-y-auto">
					{content}
				</div>
			)}
		</div>
	);
}

// ─── ThreadSidebar ────────────────────────────────────────────────────────────

interface ThreadSidebarProps {
	threads: TrainerThread[];
	activeThreadId: string | null;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onFork: (id: string) => void;
	onCompact: (id: string) => void;
	open: boolean;
	onClose: () => void;
}

interface ContextMenu {
	threadId: string;
	x: number;
	y: number;
}

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 136;
const CONTEXT_MENU_MARGIN = 8;

function getContextMenuPosition(x: number, y: number) {
	if (typeof window === "undefined") return { x, y };
	return {
		x: Math.max(
			CONTEXT_MENU_MARGIN,
			Math.min(x, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN),
		),
		y: Math.max(
			CONTEXT_MENU_MARGIN,
			Math.min(
				y,
				window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN,
			),
		),
	};
}

function ThreadSidebar({
	threads,
	activeThreadId,
	onSelect,
	onCreate,
	onRename,
	onDelete,
	onFork,
	onCompact,
	open,
	onClose,
}: ThreadSidebarProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLDivElement>(null);

	// Swipe-to-close on mobile
	useDrag(
		({ active, movement: [mx], direction: [dx], velocity: [vx] }) => {
			if (!sidebarRef.current || !open) return;
			const minSwipe = 60;
			const velocityThreshold = 0.4;

			if (!active) {
				if (
					dx < 0 &&
					(Math.abs(mx) > minSwipe || Math.abs(vx) > velocityThreshold)
				) {
					onClose();
				}
				sidebarRef.current.style.transition =
					"transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)";
				sidebarRef.current.style.transform = "translateX(0px)";
				requestAnimationFrame(() => {
					if (sidebarRef.current) sidebarRef.current.style.transition = "";
				});
			} else {
				sidebarRef.current.style.transition = "none";
				sidebarRef.current.style.transform = `translateX(${Math.min(mx, 0)}px)`;
			}
		},
		{
			target: sidebarRef,
			axis: "x",
			bounds: { left: -240, right: 0 },
			rubberband: true,
			preventDefault: true,
		},
	);

	// Close context menu on outside click or Escape
	useEffect(() => {
		if (!contextMenu) return;
		const handleClick = () => setContextMenu(null);
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setContextMenu(null);
		};
		window.addEventListener("pointerdown", handleClick);
		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("pointerdown", handleClick);
			window.removeEventListener("keydown", handleKey);
		};
	}, [contextMenu]);

	const openContextMenu = useCallback(
		(threadId: string, x: number, y: number) => {
			setContextMenu({ threadId, ...getContextMenuPosition(x, y) });
		},
		[],
	);

	const handleContextMenu = useCallback(
		(thread: TrainerThread, e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			openContextMenu(thread.id, e.clientX, e.clientY);
		},
		[openContextMenu],
	);

	const handleMenuButtonClick = useCallback(
		(thread: TrainerThread, e: React.MouseEvent<HTMLButtonElement>) => {
			e.preventDefault();
			e.stopPropagation();
			const rect = e.currentTarget.getBoundingClientRect();
			openContextMenu(
				thread.id,
				rect.right - CONTEXT_MENU_WIDTH,
				rect.bottom + 4,
			);
		},
		[openContextMenu],
	);

	const startEdit = useCallback(
		(threadId: string) => {
			const thread = threads.find((t) => t.id === threadId);
			if (!thread) return;
			setContextMenu(null);
			setEditingId(threadId);
			setEditingName(thread.name);
		},
		[threads],
	);

	const commitEdit = useCallback(() => {
		if (editingId && editingName.trim())
			onRename(editingId, editingName.trim());
		setEditingId(null);
	}, [editingId, editingName, onRename]);

	const handleDelete = useCallback((threadId: string) => {
		setContextMenu(null);
		setConfirmDeleteId(threadId);
	}, []);

	const confirmDelete = useCallback(
		(threadId: string) => {
			setConfirmDeleteId(null);
			onDelete(threadId);
		},
		[onDelete],
	);

	const handleFork = useCallback(
		(threadId: string) => {
			setContextMenu(null);
			onFork(threadId);
		},
		[onFork],
	);

	const handleCompact = useCallback(
		(threadId: string) => {
			setContextMenu(null);
			onCompact(threadId);
		},
		[onCompact],
	);

	return (
		<div
			ref={sidebarRef}
			className={`fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[82vw] shrink-0 flex-col overflow-hidden border-r border-[rgba(139,92,246,0.1)] bg-[#080612] shadow-2xl shadow-black/40 transition-transform duration-200 md:static md:z-auto md:w-52 md:max-w-none md:translate-x-0 md:shadow-none ${
				open ? "translate-x-0" : "-translate-x-full"
			}`}
		>
			<div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 border-b border-[rgba(139,92,246,0.08)]">
				<span className="text-[10px] font-semibold text-[#4a4468] uppercase tracking-widest">
					Threads
				</span>
				<button
					type="button"
					onClick={onClose}
					className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 text-[#94a3b8] md:hidden"
					title="Close threads"
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto py-1">
				{threads.map((thread) => (
					<div
						key={thread.id}
						onContextMenu={(e) => handleContextMenu(thread, e)}
						className={`group flex items-center gap-1.5 px-2 py-2 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${
							thread.id === activeThreadId
								? "bg-[#8b5cf6]/15 text-[#e2d9f3]"
								: "text-[#7c6fa0] hover:bg-[#1a1533]/50 hover:text-[#c4b5fd]"
						}`}
					>
						{editingId === thread.id ? (
							<input
								value={editingName}
								onChange={(e) => setEditingName(e.target.value)}
								onBlur={commitEdit}
								onKeyDown={(e) => {
									if (e.key === "Enter") commitEdit();
									if (e.key === "Escape") setEditingId(null);
								}}
								onClick={(e) => e.stopPropagation()}
								className="flex-1 min-w-0 bg-[#1a1533] border border-[#8b5cf6]/40 rounded px-1.5 py-0.5 text-xs text-[#e2d9f3] outline-none"
							/>
						) : (
							<button
								type="button"
								onClick={() => {
									onSelect(thread.id);
									onClose();
								}}
								className="flex flex-1 min-w-0 items-center text-left"
								aria-label={`Open thread ${thread.name}`}
							>
								<span className="min-w-0 text-xs truncate">{thread.name}</span>
							</button>
						)}

						{thread.messageCount > 0 && editingId !== thread.id && (
							<span className="text-[10px] text-[#4a4468] shrink-0 tabular-nums">
								{thread.messageCount}
							</span>
						)}

						{editingId !== thread.id && (
							<button
								type="button"
								onClick={(e) => handleMenuButtonClick(thread, e)}
								className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#7c6fa0] opacity-100 transition-colors hover:bg-[#241e3d] hover:text-[#c4b5fd] focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-[#8b5cf6]/40 md:opacity-0 md:group-hover:opacity-100"
								title={`Actions for ${thread.name}`}
								aria-label={`Actions for ${thread.name}`}
							>
								<MoreVertical className="h-3.5 w-3.5" />
							</button>
						)}
					</div>
				))}
			</div>

			<div className="p-2 border-t border-[rgba(139,92,246,0.08)]">
				<button
					type="button"
					onClick={() => {
						onCreate();
						onClose();
					}}
					className="w-full flex items-center gap-2 px-2 py-2 text-xs text-[#4a4468] hover:text-[#c4b5fd] hover:bg-[#1a1533]/50 rounded-lg transition-colors cursor-pointer"
				>
					<Plus className="w-3.5 h-3.5" />
					New Thread
				</button>
			</div>

			{contextMenu &&
				createPortal(
					<div
						ref={contextMenuRef}
						onPointerDown={(e) => e.stopPropagation()}
						style={{ top: contextMenu.y, left: contextMenu.x }}
						className="fixed z-[80] w-40 py-1 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 overflow-hidden"
						role="menu"
					>
						<button
							type="button"
							onClick={() => startEdit(contextMenu.threadId)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer"
							role="menuitem"
						>
							<Pencil className="w-3.5 h-3.5" />
							Rename
						</button>
						<div className="my-1 border-t border-[rgba(139,92,246,0.1)]" />
						<button
							type="button"
							onClick={() => handleFork(contextMenu.threadId)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer"
							role="menuitem"
						>
							<GitFork className="w-3.5 h-3.5" />
							Fork
						</button>
						<div className="my-1 border-t border-[rgba(139,92,246,0.1)]" />
						<button
							type="button"
							onClick={() => handleCompact(contextMenu.threadId)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer"
							role="menuitem"
						>
							<Minimize2 className="w-3.5 h-3.5" />
							Compact
						</button>
						<div className="my-1 border-t border-[rgba(139,92,246,0.1)]" />
						<button
							type="button"
							onClick={() => handleDelete(contextMenu.threadId)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
							role="menuitem"
						>
							<Trash2 className="w-3.5 h-3.5" />
							Delete
						</button>
					</div>,
					document.body,
				)}
			{confirmDeleteId &&
				createPortal(
					<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
						<div className="w-72 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 p-4">
							<p className="text-sm text-[#c4b5fd] mb-4">
								Are you sure you want to delete this thread?
							</p>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setConfirmDeleteId(null)}
									className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-[#c4b5fd] rounded-lg hover:bg-[#241e3d] transition-colors cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => confirmDelete(confirmDeleteId)}
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
	);
}

// ─── ModelPicker ──────────────────────────────────────────────────────────────

interface ModelPickerProps {
	currentModel: string | null;
	defaultModel: string | null;
	availableModels: ModelEntry[];
	onChange: (modelId: string) => void;
}

function ModelPicker({
	currentModel,
	defaultModel,
	availableModels,
	onChange,
}: ModelPickerProps) {
	const [open, setOpen] = useState(false);
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", handleClick);
		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("pointerdown", handleClick);
			window.removeEventListener("keydown", handleKey);
		};
	}, [open]);

	const activeModel = currentModel ?? defaultModel ?? availableModels[0]?.id ?? AVAILABLE_MODELS[0].id;
	const activeModelInfo = availableModels.find((m) => m.id === activeModel);
	const activeName = activeModelInfo?.name ?? getCoachModelDisplayName(activeModel);
	const activeProvider = activeModelInfo?.provider ?? getModelProvider(activeModel);

	const providerIcons: Record<string, React.ReactNode> = {
		openrouter: (
			<svg
				className="w-3.5 h-3.5 text-[#94a3b8]"
				viewBox="0 0 512 512"
				fill="none"
				stroke="currentColor"
				aria-hidden="true"
			>
				<path
					d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
					strokeWidth="90"
				/>
				<path
					d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"
					stroke="none"
					fill="currentColor"
				/>
				<path
					d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
					strokeWidth="90"
				/>
				<path
					d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"
					stroke="none"
					fill="currentColor"
				/>
			</svg>
		),
		"ollama-cloud": (
			<svg
				className="w-3.5 h-3.5 text-[#94a3b8]"
				viewBox="0 0 646 854"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M140.629 0.239929C132.66 1.52725 123.097 5.69568 116.354 10.845C95.941 26.3541 80.1253 59.2728 73.4435 100.283C70.9302 115.792 69.2138 137.309 69.2138 153.738C69.2138 173.109 71.4819 197.874 74.7309 214.977C75.4665 218.778 75.8343 222.15 75.5278 222.395C75.2826 222.64 72.2788 225.092 68.9072 227.789C57.3827 236.984 44.2029 251.145 35.1304 264.08C17.7209 288.784 6.44151 316.86 1.72133 347.265C-0.117698 359.28 -0.608106 383.555 0.863118 395.57C4.11207 423.278 12.449 446.695 26.7321 468.151L31.391 475.078L30.0424 477.346C20.4794 493.407 12.3264 516.64 8.52575 538.953C5.522 556.608 5.15419 561.328 5.15419 584.99C5.15419 608.837 5.4607 613.557 8.28054 630.047C11.6521 649.786 18.5178 670.689 26.1804 684.605C28.6938 689.141 34.8239 698.581 35.5595 699.072C35.8047 699.194 35.0691 701.462 33.9044 704.098C25.077 723.408 17.537 749.093 14.4106 770.733C12.2038 785.567 11.8973 790.349 11.8973 805.981C11.8973 825.903 13.0007 835.589 17.1692 851.466L17.7822 853.795H44.019H70.3172L68.6007 850.546C57.9957 830.93 57.0149 794.517 66.1487 758.166C70.3172 741.369 75.0374 729.048 83.8647 712.067L89.1366 701.769V695.455C89.1366 689.57 89.014 688.896 87.1137 685.034C85.6424 682.091 83.6808 679.578 80.1866 676.145C74.2404 670.383 69.9494 664.314 66.5165 656.835C51.4365 624.1 48.494 575.489 59.0991 534.049C63.5128 516.762 70.8076 501.376 78.4702 492.978C83.6808 487.215 86.378 480.779 86.378 474.097C86.378 467.17 83.926 461.469 78.4089 455.523C62.5932 438.604 52.8464 418.006 49.3522 394.038C44.3868 359.893 53.3981 322.683 73.8726 293.198C93.9181 264.263 122.055 245.689 153.503 240.724C160.552 239.559 173.732 239.743 181.088 241.092C189.119 242.502 194.145 242.072 199.295 239.62C205.67 236.617 208.858 232.877 212.597 224.295C215.907 216.633 218.482 212.464 225.409 203.821C233.746 193.461 241.776 186.411 254.649 177.89C269.362 168.266 286.097 161.278 302.771 157.906C308.839 156.68 311.659 156.496 323 156.496C334.341 156.496 337.161 156.68 343.229 157.906C367.688 162.872 391.964 175.5 411.335 193.399C415.503 197.261 425.495 209.644 428.683 214.794C429.909 216.816 432.055 221.108 433.403 224.295C437.142 232.877 440.33 236.617 446.705 239.62C451.671 242.011 456.881 242.502 464.605 241.214C476.804 239.13 486.183 239.314 498.137 241.766C538.841 249.98 574.273 283.512 589.966 328.446C603.636 367.862 599.774 409.118 579.422 440.626C575.989 445.96 572.556 450.251 567.591 455.523C556.863 466.986 556.863 481.208 567.53 492.978C585.062 512.165 596.035 559.367 592.724 600.99C590.518 628.453 583.468 653.035 573.782 666.95C572.066 669.402 568.511 673.57 565.813 676.145C562.319 679.578 560.358 682.091 558.886 685.034C556.986 688.896 556.863 689.57 556.863 695.455V701.769L562.135 712.067C570.963 729.048 575.683 741.369 579.851 758.166C588.863 794.027 588.066 829.704 577.767 849.995C576.909 851.711 576.173 853.305 576.173 853.489C576.173 853.673 587.882 853.795 602.226 853.795H628.218L628.892 851.159C629.26 849.75 629.873 847.604 630.179 846.378C630.854 843.681 632.202 835.712 633.306 828.049C634.348 820.325 634.348 791.881 633.306 783.299C629.383 752.158 622.823 727.454 612.096 704.098C610.931 701.462 610.195 699.194 610.44 699.072C610.747 698.888 612.463 696.436 614.302 693.677C627.666 673.448 635.88 648.008 640.049 614.415C641.152 605.158 641.152 565.374 640.049 556.485C637.106 533.559 633.551 517.988 627.666 502.234C625.214 495.675 618.716 481.821 615.958 477.346L614.609 475.078L619.268 468.151C633.551 446.695 641.888 423.278 645.137 395.57C646.608 383.555 646.118 359.28 644.279 347.265C639.497 316.798 628.279 288.845 610.87 264.08C601.797 251.145 588.617 236.984 577.093 227.789C573.721 225.092 570.717 222.64 570.472 222.395C570.166 222.15 570.534 218.778 571.269 214.977C578.687 176.296 578.441 128.053 570.656 90.3524C563.913 57.4951 551.653 31.3808 535.837 16.3008C523.209 4.28578 510.336 -0.863507 494.888 0.11731C459.456 2.20154 430.89 42.9667 419.61 107.21C417.771 117.57 416.178 129.708 416.178 133.018C416.178 134.305 415.932 135.347 415.626 135.347C415.319 135.347 412.929 134.121 410.354 132.589C383.014 116.405 352.608 107.762 323 107.762C293.392 107.762 262.986 116.405 235.646 132.589C233.071 134.121 230.681 135.347 230.374 135.347C230.068 135.347 229.822 134.305 229.822 133.018C229.822 129.585 228.167 117.08 226.39 107.21C216.152 49.5259 192.674 11.3354 161.472 1.71112C157.181 0.423799 144.982 -0.434382 140.629 0.239929ZM151.051 50.139C159.878 57.1273 169.686 77.1114 175.326 99.4863C176.368 103.532 177.471 108.191 177.778 109.907C178.023 111.563 178.697 115.302 179.249 118.183C181.64 131.179 182.743 145.217 182.866 162.32L182.927 179.178L178.697 185.43L174.468 191.744H164.598C153.074 191.744 141.61 193.216 130.637 196.158C126.714 197.139 122.913 198.12 122.178 198.304C121.013 198.549 120.829 198.181 120.155 193.154C116.538 165.875 116.722 135.654 120.707 110.52C125.12 82.5059 135.419 57.1273 145.472 49.6486C147.863 47.8708 148.292 47.9321 151.051 50.139ZM500.589 49.7098C506.658 54.1848 513.34 66.0772 518.305 81.2798C528.297 111.685 531.117 153.431 525.845 193.154C525.171 198.181 524.987 198.549 523.822 198.304C523.087 198.12 519.286 197.139 515.363 196.158C504.39 193.216 492.926 191.744 481.402 191.744H471.532L467.303 185.43L463.073 179.178L463.134 162.32C463.257 138.535 465.464 119.961 470.735 99.3024C476.314 77.1114 486.183 57.1273 494.949 50.139C497.708 47.9321 498.137 47.8708 500.589 49.7098Z"
					fill="currentColor"
				/>
				<path
					d="M313.498 358.237C300.195 359.525 296.579 360.015 290.203 361.303C279.843 363.448 265.989 368.23 256.365 372.95C222.895 389.317 199.846 416.596 192.796 448.166C191.386 454.419 191.202 456.503 191.202 467.047C191.202 477.468 191.386 479.736 192.735 485.682C202.114 526.938 240.12 557.405 289.284 562.983C299.95 564.148 346.049 564.148 356.715 562.983C396.193 558.508 430.154 537.114 445.418 507.076C449.463 499.046 451.425 493.835 453.264 485.682C454.613 479.736 454.797 477.468 454.797 467.047C454.797 456.503 454.613 454.419 453.203 448.166C442.965 402.313 398.461 366.207 343.903 359.341C336.792 358.483 318.157 357.747 313.498 358.237ZM336.424 391.585C354.631 393.547 372.96 400.045 387.672 409.853C395.58 415.125 406.737 426.159 411.518 433.393C417.403 442.342 420.774 451.476 422.307 462.572C422.981 467.66 422.614 471.522 420.774 479.736C417.893 491.996 408.943 504.808 396.867 513.758C391.227 517.865 379.519 523.812 372.347 526.141C358.738 530.493 349.849 531.29 318.095 531.045C297.376 530.861 293.697 530.677 287.751 529.574C267.461 525.773 251.4 517.681 239.753 505.36C230.312 495.429 226.021 486.357 223.692 471.706C222.65 464.901 224.611 453.622 228.596 444.12C233.439 432.534 245.944 418.129 258.327 409.853C272.671 400.29 291.552 393.486 308.9 391.647C315.582 390.911 329.742 390.911 336.424 391.585Z"
					fill="currentColor"
				/>
				<path
					d="M299.584 436.336C294.925 438.849 291.676 445.224 292.657 449.944C293.76 455.032 298.235 460.182 305.223 464.412C308.963 466.68 309.208 466.986 309.392 469.254C309.514 470.603 309.024 474.465 308.35 477.898C307.614 481.269 307.062 484.825 307.062 485.806C307.124 488.442 309.576 492.733 312.15 494.817C314.419 496.656 314.848 496.717 321.223 496.901C327.047 497.085 328.273 496.962 330.602 495.859C336.61 492.916 338.142 487.522 335.935 477.162C334.096 468.519 334.464 467.17 339.062 464.534C343.904 461.714 349.054 456.749 350.586 453.377C353.529 446.941 350.831 439.646 344.333 436.274C342.74 435.477 340.778 435.11 337.897 435.11C333.422 435.11 330.541 436.152 325.269 439.523L322.265 441.424L320.365 440.259C312.58 435.661 311.17 435.11 306.449 435.171C303.078 435.171 301.239 435.477 299.584 436.336Z"
					fill="currentColor"
				/>
				<path
					d="M150.744 365.165C139.894 368.598 131.802 376.567 127.634 387.908C125.611 393.303 124.63 401.824 125.488 406.421C127.511 417.394 136.522 427.386 146.76 430.145C159.633 433.516 169.257 431.309 177.778 422.85C182.743 418.007 185.441 413.777 188.138 406.911C190.099 402.069 190.222 401.211 190.222 394.345L190.283 386.989L187.709 381.717C183.601 373.38 176.184 367.188 167.602 364.92C162.759 363.694 154.974 363.756 150.744 365.165Z"
					fill="currentColor"
				/>
				<path
					d="M478.153 364.982C469.755 367.25 462.276 373.502 458.291 381.717L455.717 386.989L455.778 394.345C455.778 401.211 455.901 402.069 457.862 406.911C460.56 413.777 463.257 418.007 468.222 422.85C476.743 431.309 486.367 433.516 499.241 430.145C506.658 428.183 514.075 421.93 517.631 414.635C520.696 408.444 521.431 403.969 520.451 396.919C518.183 380.797 508.742 369.089 494.704 364.982C490.597 363.756 482.628 363.756 478.153 364.982Z"
					fill="currentColor"
				/>
			</svg>
		),
	};

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => {
					setSelectedProvider(activeProvider ?? null);
					setOpen((o) => !o);
				}}
				className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#94a3b8] hover:text-[#c4b5fd] bg-[#1a1533]/60 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-lg transition-all duration-200 cursor-pointer"
				title={activeModel}
			>
				{activeProvider && providerIcons[activeProvider]}
				<span className="truncate max-w-[10rem]">{activeName}</span>
				<ChevronDown
					className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{open &&
				createPortal(
					<div
						className="fixed z-[80] w-64 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 overflow-hidden flex max-h-[340px]"
							style={(() => {
								const rect = containerRef.current?.getBoundingClientRect();
								if (!rect) return {};
								const spaceBelow = window.innerHeight - rect.bottom;
								const openUpward = spaceBelow < 200 && rect.top > 200;
								const dropdownWidth = 256;
								const left = Math.max(
									8,
									Math.min(
										rect.left,
										window.innerWidth - dropdownWidth - 8,
									),
								);
								if (openUpward) {
									return {
										left,
										bottom: window.innerHeight - rect.top + 6,
									};
								}
								return { left, top: rect.bottom + 6 };
							})()}
						onPointerDown={(e) => e.stopPropagation()}
						role="menu"
					>
						{(() => {
								const groups = new Map<string, ModelEntry[]>();
								for (const model of availableModels) {
								const arr = groups.get(model.provider);
								if (arr) {
									arr.push(model);
								} else {
									groups.set(model.provider, [model]);
								}
							}
							const providerLabels: Record<string, string> = {
								openrouter: "OpenRouter",
								"ollama-cloud": "Ollama Cloud",
							};

							const providers = Array.from(groups.keys());
							const effectiveProvider =
								selectedProvider ?? activeProvider ?? providers[0];
							const visibleModels = groups.get(effectiveProvider) ?? [];

							return (
								<>
									<div className="flex flex-col border-r border-[rgba(139,92,246,0.1)] py-2">
										{providers.map((provider) => (
											<button
												key={provider}
												type="button"
												onClick={() => setSelectedProvider(provider)}
												className={`flex items-center justify-center w-10 h-10 mx-1 rounded-lg transition-colors cursor-pointer ${
													provider === effectiveProvider
														? "text-[#c4b5fd] bg-[#8b5cf6]/15"
														: "text-[#94a3b8] hover:text-[#c4b5fd] hover:bg-[#8b5cf6]/10"
												}`}
												title={providerLabels[provider] ?? provider}
											>
												{providerIcons[provider]}
											</button>
										))}
									</div>
									<div className="flex-1 py-1 overflow-y-auto max-h-[320px]">
										<div className="px-3 py-1.5 text-[10px] font-semibold text-[#64748b] uppercase tracking-wider flex items-center gap-1.5">
											{providerIcons[effectiveProvider]}
											{providerLabels[effectiveProvider] ?? effectiveProvider}
										</div>
										{visibleModels.map((model) => (
											<button
												key={model.id}
												type="button"
												onClick={() => {
													onChange(model.id);
													setOpen(false);
												}}
												className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors cursor-pointer ${
													model.id === activeModel
														? "bg-[#8b5cf6]/15 text-[#e2d9f3]"
														: "text-[#c4b5fd] hover:bg-[#8b5cf6]/15"
												}`}
												role="menuitem"
											>
												<span className="flex-1 text-left truncate">
													{model.name}
												</span>
											</button>
										))}
									</div>
								</>
							);
						})()}
					</div>,
					document.body,
				)}
		</div>
	);
}

function MessageActions({
	msg,
	isCurrentlyStreaming,
	onDelete,
	onRetry,
	canRetry,
}: {
	msg: UIMessage;
	isCurrentlyStreaming: boolean;
	onDelete: () => void;
	onRetry: () => void;
	canRetry: boolean;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		const text = getTextContent(msg);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	if (isCurrentlyStreaming) return null;

	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				onClick={handleCopy}
				title="Copy message"
				className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors cursor-pointer ${
					copied
						? "text-emerald-400"
						: "text-[#7c6fa0] hover:text-[#c4b5fd] hover:bg-[#8b5cf6]/10"
				}`}
			>
				{copied ? (
					<Check className="w-3.5 h-3.5" />
				) : (
					<Clipboard className="w-3.5 h-3.5" />
				)}
			</button>
			<button
				type="button"
				onClick={onDelete}
				title="Delete message"
				className="flex items-center justify-center w-7 h-7 rounded-md text-[#7c6fa0] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
			>
				<Trash2 className="w-3.5 h-3.5" />
			</button>
			<button
				type="button"
				onClick={onRetry}
				disabled={!canRetry}
				title="Retry generation"
				className="flex items-center justify-center w-7 h-7 rounded-md text-[#7c6fa0] hover:text-[#c4b5fd] hover:bg-[#8b5cf6]/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
			>
				<RefreshCw className="w-3.5 h-3.5" />
			</button>
		</div>
	);
}

// ─── TrainerChat ──────────────────────────────────────────────────────────────

interface TrainerChatProps {
	threadId: string;
	activityId: string;
	initialMessages: UIMessage[];
	initialInput: string;
	onBack: () => void;
	onOpenThreads: () => void;
	onImported: () => void;
	threadModel: string | null;
	defaultModel: string | null;
	availableModels: ModelEntry[];
	onModelChange: (modelId: string) => void;
}

function TrainerChat({
	threadId,
	activityId,
	initialMessages,
	initialInput,
	onBack,
	onOpenThreads,
	onImported,
	threadModel,
	defaultModel,
	availableModels,
	onModelChange,
}: TrainerChatProps) {
	const connectionRef = useRef(createTrainerStreamConnection(threadId));
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

	const activeModel = threadModel ?? defaultModel ?? availableModels[0]?.id ?? AVAILABLE_MODELS[0].id;
	const coachModelName = availableModels.find((m) => m.id === activeModel)?.name ?? getCoachModelDisplayName(activeModel);

	useEffect(() => {
		const activeStream = loadActiveTrainerStream(threadId);
		if (!activeStream) return;

		const abortController = new AbortController();
		let baseMessages = stripTrailingAssistant(initialMessages);
		setMessages(baseMessages);

		streamResumedChat(
			activeStream.streamId,
			(chunk) => {
				baseMessages = applyResumedChunk(baseMessages, chunk);
				setMessages(baseMessages);

				if (chunk.type === "RUN_FINISHED" || chunk.type === "RUN_ERROR") {
					clearActiveTrainerStream(threadId);
					clearTrainerDraft(threadId);
					const toSave = baseMessages
						.filter(
							(message) =>
								message.role === "user" || message.role === "assistant",
						)
						.map(toTrainerMessage)
						.filter((message) => message.content);
					if (toSave.length > 0)
						saveTrainerHistory(threadId, toSave).catch(console.error);
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

	const updateScrollButtons = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setShowScrollTop(el.scrollTop > 50);
		setShowScrollBottom(el.scrollTop < el.scrollHeight - el.clientHeight - 50);
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

	const adjustHeight = useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, []);
	useEffect(() => {
		adjustHeight();
	}, [adjustHeight]);

	const isFirstRender = useRef(true);
	const lastMessageId = messages[messages.length - 1]?.id;
	const lastMessageTextLen = messages[messages.length - 1]?.parts?.length ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: lastMessageTextLen is intentionally included to re-trigger scroll during streaming updates to the same message id
	useEffect(() => {
		if (!isFirstRender.current && lastMessageId === undefined) return;
		const behavior = isFirstRender.current ? "instant" : "smooth";
		isFirstRender.current = false;
		bottomRef.current?.scrollIntoView({ behavior });
		setTimeout(updateScrollButtons, 120);
	}, [lastMessageId, lastMessageTextLen, updateScrollButtons]);

	const prevStatus = useRef(status);
	useEffect(() => {
		const wasStreaming = prevStatus.current === "streaming";
		const nowReady = status === "ready";
		if (wasStreaming && nowReady && messages.length > 0) {
			const toSave = messages
				.filter((m) => m.role === "user" || m.role === "assistant")
				.map(toTrainerMessage)
				.filter((m) => m.content);
			if (toSave.length > 0)
				saveTrainerHistory(threadId, toSave).catch(console.error);
			clearTrainerDraft(threadId);
		}
		prevStatus.current = status;
	}, [status, messages, threadId]);

	useEffect(() => {
		if (status === "streaming" || status === "submitted") {
			saveTrainerDraft(threadId, messages);
		}
	}, [messages, status, threadId]);

	const handleSend = useCallback(async () => {
		const text = inputRef.current.trim();
		if (!text || isLoading) return;
		inputRef.current = "";
		if (textareaRef.current) textareaRef.current.value = "";
		setHasInput(false);
		adjustHeight();
		await sendMessage(text);
	}, [isLoading, sendMessage, adjustHeight]);

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
			const toSave = nextMessages
				.filter((m) => m.role === "user" || m.role === "assistant")
				.map(toTrainerMessage)
				.filter((m) => m.content);
			if (toSave.length > 0)
				saveTrainerHistory(threadId, toSave).catch(console.error);
		},
		[messages, setMessages, threadId],
	);

	const isGeneralChat = activityId === "general";

	return (
		<div className="flex-1 flex flex-col min-h-0 min-w-0">
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
								? `${coachModelName} via ${getModelProvider(activeModel) === "ollama-cloud" ? "Ollama Cloud" : "OpenRouter"}`
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
					onScroll={updateScrollButtons}
					className="absolute inset-0 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 space-y-4"
				>
					{messages.length === 0 && (
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
						const isUser = msg.role === "user";
						const isLastMsg = msg.id === lastMessageId;
						const isCurrentlyStreaming = isLastMsg && status === "streaming";

						const handleRetry = async () => {
							const msgText = getTextContent(msg);
							if (msg.role === "user") {
								if (isLoading) stop();
								const truncated = messages.slice(0, msgIndex);
								setMessages(truncated);
								const toSave = truncated
									.filter((m) => m.role === "user" || m.role === "assistant")
									.map(toTrainerMessage)
									.filter((m) => m.content);
								if (toSave.length > 0)
									saveTrainerHistory(threadId, toSave).catch(console.error);
								await sendMessage(msgText);
								return;
							}
							const isLastAssistant =
								messages.findLastIndex((m) => m.role === "assistant") === msgIndex;
							if (isLastAssistant) {
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
							const toSave = truncated
								.filter((m) => m.role === "user" || m.role === "assistant")
								.map(toTrainerMessage)
								.filter((m) => m.content);
							if (toSave.length > 0)
								saveTrainerHistory(threadId, toSave).catch(console.error);
							await sendMessage(userText);
						};

						if (isUser) {
							const text = getTextContent(msg);
							if (!text) return null;
							return (
								<div key={msg.id} className="flex flex-col items-end gap-1">
									<div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
										{text}
									</div>
									<div className="flex items-center gap-2 pr-1">
										<MessageActions
											msg={msg}
											isCurrentlyStreaming={isCurrentlyStreaming}
											onDelete={() => setConfirmDeleteMessageId(msg.id)}
											onRetry={handleRetry}
											canRetry={true}
										/>
										<span className="text-[10px] text-[#4a4468]">
											{formatTime(msg.createdAt)}
										</span>
									</div>
								</div>
							);
							}

							const thinkingContent = getThinkingContent(msg);
							const textContent = getTextContent(msg);
							const isThinkingPhase =
								isCurrentlyStreaming && !!thinkingContent && !textContent;

							return (
								<div key={msg.id} className="flex flex-col items-start gap-1">
									<div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd] [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
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
									<div className="flex items-center gap-2 pl-1">
										<MessageActions
											msg={msg}
											isCurrentlyStreaming={isCurrentlyStreaming}
											onDelete={() => setConfirmDeleteMessageId(msg.id)}
											onRetry={handleRetry}
											canRetry={true}
										/>
										{!isCurrentlyStreaming && textContent && (
											<span className="text-[10px] text-[#4a4468]">
												{formatTime(msg.createdAt)}
											</span>
										)}
									</div>
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
							adjustHeight();
						}}
						onKeyDown={handleKeyDown}
						placeholder="Ask your trainer..."
						rows={1}
						className="flex-1 resize-none bg-transparent text-sm text-[#f1f5f9] placeholder-[#4a4468] outline-none leading-relaxed"
						style={{ maxHeight: "200px" }}
					/>
					<div className="flex items-center gap-2">
						<ModelPicker
							currentModel={threadModel}
							defaultModel={defaultModel}
							availableModels={availableModels}
							onChange={onModelChange}
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

// ─── TrainerView ──────────────────────────────────────────────────────────────

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
