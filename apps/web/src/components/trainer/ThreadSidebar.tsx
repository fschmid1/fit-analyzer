import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@use-gesture/react";
import {
	ChevronDown,
	ChevronRight,
	Columns,
	Download,
	GitFork,
	Loader2,
	Minimize2,
	MoreVertical,
	Pencil,
	Pin,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import type { TrainerThread } from "@fit-analyzer/shared";

interface ThreadSidebarProps {
	threads: TrainerThread[];
	activeThreadId: string | null;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onRename: (id: string, name: string) => void;
	onDelete: (id: string) => void;
	onFork: (id: string) => void;
	onCompact: (id: string) => void;
	compactingThreadId: string | null;
	onExport: (id: string) => void;
	open: boolean;
	onClose: () => void;
	compareMode?: boolean;
	pinnedThreadIds?: string[];
	maxPinned?: number;
	onTogglePin?: (id: string) => void;
	onToggleCompare?: () => void;
}

interface ContextMenu {
	threadId: string;
	x: number;
	y: number;
}

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 180;
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

function formatContextTokens(tokens: number | undefined): string {
	if (tokens == null) return "—";
	if (tokens < 1_000) return `${tokens}`;
	if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function ThreadSidebar({
	threads,
	activeThreadId,
	onSelect,
	onCreate,
	onRename,
	onDelete,
	onFork,
	onCompact,
	compactingThreadId,
	onExport,
	open,
	onClose,
	compareMode = false,
	pinnedThreadIds = [],
	maxPinned = 4,
	onTogglePin,
	onToggleCompare,
}: ThreadSidebarProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [exportingThreadId, setExportingThreadId] = useState<string | null>(
		null,
	);
	const [exportError, setExportError] = useState<{
		threadId: string;
		message: string;
	} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLDivElement>(null);
	const editInputRef = useRef<HTMLInputElement>(null);

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
			eventOptions: { passive: false },
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

	useEffect(() => {
		if (editingId === null) return;
		const input = editInputRef.current;
		if (!input) return;
		const stop = (e: Event) => e.stopPropagation();
		input.addEventListener("pointerdown", stop);
		input.addEventListener("mousedown", stop);
		input.addEventListener("click", stop);
		const id = window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
		return () => {
			window.clearTimeout(id);
			input.removeEventListener("pointerdown", stop);
			input.removeEventListener("mousedown", stop);
			input.removeEventListener("click", stop);
		};
	}, [editingId]);

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

	const handleExport = useCallback(
		async (threadId: string) => {
			setContextMenu(null);
			setExportingThreadId(threadId);
			setExportError(null);
			try {
				await onExport(threadId);
			} catch (err) {
				setExportError({
					threadId,
					message: err instanceof Error ? err.message : "Export failed",
				});
			} finally {
				setExportingThreadId(null);
			}
		},
		[onExport],
	);

	useEffect(() => {
		if (!exportError) return;
		const timer = window.setTimeout(() => setExportError(null), 4000);
		return () => window.clearTimeout(timer);
	}, [exportError]);

	return (
		<div
			ref={sidebarRef}
			style={{ touchAction: "pan-y" }}
			className={`fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[82vw] shrink-0 flex-col overflow-hidden border-r border-[rgba(139,92,246,0.1)] bg-[#080612] shadow-2xl shadow-black/40 transition-transform duration-200 md:static md:z-auto md:w-52 md:max-w-none md:translate-x-0 md:shadow-none ${
				open ? "translate-x-0" : "-translate-x-full"
			}`}
		>
			<div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 border-b border-[rgba(139,92,246,0.08)]">
				<span className="text-[10px] font-semibold text-[#4a4468] uppercase tracking-widest">
					Threads
				</span>
				<div className="flex items-center gap-1">
					{onToggleCompare && (
						<button
							type="button"
							onClick={onToggleCompare}
							title={compareMode ? "Exit compare mode" : "Compare threads"}
							aria-label={compareMode ? "Exit compare mode" : "Compare threads"}
							aria-pressed={compareMode}
							className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
								compareMode
									? "bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#c4b5fd]"
									: "border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 text-[#94a3b8] hover:text-[#c4b5fd]"
							}`}
						>
							<Columns
								className="h-3.5 w-3.5"
								fill={compareMode ? "currentColor" : "none"}
							/>
						</button>
					)}
					<button
						type="button"
						onClick={onClose}
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 text-[#94a3b8] md:hidden"
						title="Close threads"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto py-1">
				{threads.map((thread) => {
					const isPinned = pinnedThreadIds.includes(thread.id);
					const canPin = isPinned || pinnedThreadIds.length < maxPinned;
					const isEditing = editingId === thread.id;
					return (
						<div
							key={thread.id}
							// biome-ignore lint/a11y/useSemanticElements: row contains nested interactive children (pin, kebab, rename input) so it cannot be a <button>
							role="button"
							tabIndex={isEditing ? -1 : 0}
							aria-label={`Open thread ${thread.name}`}
							aria-current={thread.id === activeThreadId ? "true" : undefined}
							onClick={() => {
								if (isEditing) return;
								onSelect(thread.id);
								onClose();
							}}
							onKeyDown={(e) => {
								if (isEditing) return;
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelect(thread.id);
									onClose();
								}
							}}
							onContextMenu={(e) => handleContextMenu(thread, e)}
							className={`group flex items-center gap-1.5 px-2 py-2 mx-1 my-0.5 rounded-lg cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#8b5cf6]/40 ${
								thread.id === activeThreadId
									? "bg-[#8b5cf6]/15 text-[#e2d9f3]"
									: isPinned
										? "bg-[#8b5cf6]/8 text-[#c4b5fd]"
										: "text-[#7c6fa0] hover:bg-[#1a1533]/50 hover:text-[#c4b5fd]"
							}`}
						>
							{compareMode && onTogglePin && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										if (canPin) onTogglePin(thread.id);
									}}
									disabled={!canPin}
									title={
										isPinned
											? `Unpin ${thread.name}`
											: canPin
												? `Pin ${thread.name} for compare`
												: `Max ${maxPinned} threads pinned`
									}
									aria-label={
										isPinned
											? `Unpin ${thread.name}`
											: `Pin ${thread.name} for compare`
									}
									aria-pressed={isPinned}
									className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed ${
										isPinned
											? "text-[#8b5cf6] bg-[#8b5cf6]/15 hover:bg-[#8b5cf6]/25"
											: "text-[#4a4468] hover:text-[#c4b5fd] hover:bg-[#241e3d] disabled:opacity-30"
									}`}
								>
									<Pin
										className="h-3.5 w-3.5"
										fill={isPinned ? "currentColor" : "none"}
									/>
								</button>
							)}

							{isEditing ? (
								<input
									ref={editInputRef}
									value={editingName}
									onChange={(e) => setEditingName(e.target.value)}
									onBlur={commitEdit}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitEdit();
										if (e.key === "Escape") setEditingId(null);
									}}
									onPointerDown={(e) => e.stopPropagation()}
									onMouseDown={(e) => e.stopPropagation()}
									onClick={(e) => e.stopPropagation()}
									className="flex-1 min-w-0 bg-[#1a1533] border border-[#8b5cf6]/40 rounded px-1.5 py-0.5 text-xs text-[#e2d9f3] outline-none"
								/>
							) : (
								<div className="flex flex-1 min-w-0 items-center text-left gap-1.5">
									<span className="min-w-0 text-xs truncate">
										{thread.name}
									</span>
								</div>
							)}

							{thread.messageCount > 0 && !isEditing && (
								<span
									className="text-[10px] shrink-0 tabular-nums"
									title={`${formatContextTokens(thread.contextTokens)} tokens · ${thread.messageCount} messages`}
								>
									<span className="text-[#7c6fa0]">
										{formatContextTokens(thread.contextTokens)}
									</span>
									<span className="text-[#4a4468] mx-1">·</span>
									<span className="text-[#4a4468]">{thread.messageCount}</span>
								</span>
							)}

							{!isEditing && (
								<button
									type="button"
									onClick={(e) => handleMenuButtonClick(thread, e)}
									disabled={compactingThreadId === thread.id}
									className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-[#8b5cf6]/40 md:opacity-0 md:group-hover:opacity-100 ${
										compactingThreadId === thread.id
											? "text-[#8b5cf6] bg-[#8b5cf6]/15 animate-pulse"
											: "text-[#7c6fa0] opacity-100 hover:bg-[#241e3d] hover:text-[#c4b5fd]"
									}`}
									title={
										compactingThreadId === thread.id
											? `Compacting ${thread.name}…`
											: `Actions for ${thread.name}`
									}
									aria-label={
										compactingThreadId === thread.id
											? `Compacting ${thread.name}`
											: `Actions for ${thread.name}`
									}
								>
									{compactingThreadId === thread.id ? (
										<Loader2 className="h-3.5 w-3.5 animate-spin" />
									) : (
										<MoreVertical className="h-3.5 w-3.5" />
									)}
								</button>
							)}
						</div>
					);
				})}
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
							onClick={() => handleExport(contextMenu.threadId)}
							disabled={exportingThreadId === contextMenu.threadId}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
							role="menuitem"
						>
							{exportingThreadId === contextMenu.threadId ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Download className="w-3.5 h-3.5" />
							)}
							{exportingThreadId === contextMenu.threadId
								? "Exporting…"
								: "Export"}
						</button>
						<div className="my-1 border-t border-[rgba(139,92,246,0.1)]" />
						<button
							type="button"
							onClick={() => handleCompact(contextMenu.threadId)}
							disabled={compactingThreadId === contextMenu.threadId}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
							role="menuitem"
						>
							{compactingThreadId === contextMenu.threadId ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Minimize2 className="w-3.5 h-3.5" />
							)}
							{compactingThreadId === contextMenu.threadId
								? "Compacting…"
								: "Compact"}
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
