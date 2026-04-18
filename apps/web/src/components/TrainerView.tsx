import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@tanstack/ai-react";
import { fetchServerSentEvents } from "@tanstack/ai-client";
import {
  ArrowDown, ArrowLeft, ArrowUp, Brain, ChevronDown, ChevronRight,
  Menu, Minimize2, MoreVertical, Pencil, Plus, Send, Square, Trash2, Upload, X,
} from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerMessage, TrainerThread } from "@fit-analyzer/shared";
import {
  compactTrainerHistory, createThread, deleteThread, fetchThreads,
  fetchTrainerHistory, importTrainerChat, renameThread, saveTrainerHistory,
} from "../lib/api";
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
    .filter((p): p is Extract<typeof p, { type: "thinking" }> => p.type === "thinking")
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

function formatTime(date: Date | undefined): string {
  if (!date) return "";
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

// ─── markdown components (unchanged) ─────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-lg font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-[#e2d9f3] mt-2 mb-1 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc list-outside pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[#e2d9f3]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#d4b8fd]">{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <code className="block bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2 my-2 text-sm font-mono text-[#a78bfa] overflow-x-auto whitespace-pre">{children}</code>
    ) : (
      <code className="bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded px-1.5 py-0.5 text-sm font-mono text-[#a78bfa]">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-[#8b5cf6]/50 pl-3 my-2 text-[#a78bfa] italic">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#a78bfa] underline underline-offset-2 hover:text-[#c4b5fd] transition-colors">{children}</a>,
  hr: () => <hr className="border-[rgba(139,92,246,0.2)] my-3" />,
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto my-2">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#8b5cf6]/10">{children}</thead>,
  th: ({ children }) => <th className="border border-[rgba(139,92,246,0.2)] px-2 py-1.5 text-left font-semibold text-[#e2d9f3]">{children}</th>,
  td: ({ children }) => <td className="border border-[rgba(139,92,246,0.15)] px-2 py-1.5 text-[#c4b5fd]">{children}</td>,
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

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (isStreaming) setOpen(true);
    else setOpen(false);
  }, [isStreaming]);
  return (
    <div className="mb-3 rounded-lg border border-[rgba(139,92,246,0.15)] bg-[#0f0b1a]/60 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#7c6fa0] hover:text-[#a78bfa] transition-colors cursor-pointer"
      >
        <Brain className="w-3.5 h-3.5 shrink-0" />
        {isStreaming ? (
          <span className="flex items-center gap-2">Thinking<DotsLoader /></span>
        ) : (
          <span>Reasoning</span>
        )}
        <span className="ml-auto">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
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
  open: boolean;
  onClose: () => void;
}

interface ContextMenu {
  threadId: string;
  x: number;
  y: number;
}

const CONTEXT_MENU_WIDTH = 160;
const CONTEXT_MENU_HEIGHT = 104;
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
      Math.min(y, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN),
    ),
  };
}

function ThreadSidebar({ threads, activeThreadId, onSelect, onCreate, onRename, onDelete, open, onClose }: ThreadSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    window.addEventListener("pointerdown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback((threadId: string, x: number, y: number) => {
    setContextMenu({ threadId, ...getContextMenuPosition(x, y) });
  }, []);

  const handleContextMenu = useCallback((thread: TrainerThread, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(thread.id, e.clientX, e.clientY);
  }, [openContextMenu]);

  const handleMenuButtonClick = useCallback((thread: TrainerThread, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(thread.id, rect.right - CONTEXT_MENU_WIDTH, rect.bottom + 4);
  }, [openContextMenu]);

  const startEdit = useCallback((threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    setContextMenu(null);
    setEditingId(threadId);
    setEditingName(thread.name);
  }, [threads]);

  const commitEdit = useCallback(() => {
    if (editingId && editingName.trim()) onRename(editingId, editingName.trim());
    setEditingId(null);
  }, [editingId, editingName, onRename]);

  const handleDelete = useCallback((threadId: string) => {
    setContextMenu(null);
    onDelete(threadId);
  }, [onDelete]);

  return (
    <div className={`fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[82vw] shrink-0 flex-col overflow-hidden border-r border-[rgba(139,92,246,0.1)] bg-[#080612] shadow-2xl shadow-black/40 transition-transform duration-200 md:static md:z-auto md:w-52 md:max-w-none md:translate-x-0 md:shadow-none ${
      open ? "translate-x-0" : "-translate-x-full"
    }`}>
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 border-b border-[rgba(139,92,246,0.08)]">
        <span className="text-[10px] font-semibold text-[#4a4468] uppercase tracking-widest">
          Threads
        </span>
        <button
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
            onClick={() => {
              onSelect(thread.id);
              onClose();
            }}
            onContextMenu={(e) => handleContextMenu(thread, e)}
            className={`group flex items-center gap-1.5 px-2 py-2 mx-1 my-0.5 rounded-lg cursor-pointer transition-colors ${
              thread.id === activeThreadId
                ? "bg-[#8b5cf6]/15 text-[#e2d9f3]"
                : "text-[#7c6fa0] hover:bg-[#1a1533]/50 hover:text-[#c4b5fd]"
            }`}
          >
            {editingId === thread.id ? (
              <input
                autoFocus
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
              <span className="flex-1 min-w-0 text-xs truncate">
                {thread.name}
              </span>
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

      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-[80] w-40 py-1 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 overflow-hidden"
          role="menu"
        >
          <button
            onClick={() => startEdit(contextMenu.threadId)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#c4b5fd] hover:bg-[#8b5cf6]/15 transition-colors cursor-pointer"
            role="menuitem"
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
          <div className="my-1 border-t border-[rgba(139,92,246,0.1)]" />
          <button
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
    </div>
  );
}

// ─── stable SSE connection ────────────────────────────────────────────────────

const connection = fetchServerSentEvents("/api/trainer/chat");

// ─── TrainerChat ──────────────────────────────────────────────────────────────

interface TrainerChatProps {
  threadId: string;
  activityId: string;
  initialMessages: UIMessage[];
  initialInput: string;
  onBack: () => void;
  onOpenThreads: () => void;
  onImported: () => void;
  onCompacted: (newThread: TrainerThread) => void;
}

function TrainerChat({ threadId, activityId, initialMessages, initialInput, onBack, onOpenThreads, onImported, onCompacted }: TrainerChatProps) {
  const { messages, sendMessage, status, isLoading, stop, error } = useChat({
    connection,
    initialMessages,
  });

  const inputRef = useRef(initialInput);
  const [hasInput, setHasInput] = useState(!!initialInput.trim());
  const [importState, setImportState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [compactState, setCompactState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [compactError, setCompactError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [threadId, onImported]);

  const handleCompact = useCallback(async () => {
    setCompactState("loading");
    setCompactError(null);
    try {
      const result = await compactTrainerHistory(threadId);
      setCompactState("done");
      setTimeout(() => setCompactState("idle"), 3000);
      if (result.compacted) onCompacted(result.thread);
    } catch (err) {
      setCompactError(err instanceof Error ? err.message : "Compaction failed");
      setCompactState("error");
      setTimeout(() => setCompactState("idle"), 5000);
    }
  }, [threadId, onCompacted]);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > 50);
    setShowScrollBottom(el.scrollTop < el.scrollHeight - el.clientHeight - 50);
  }, []);

  const scrollToTop = useCallback(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), []);
  const scrollToBottom = useCallback(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), []);

  useEffect(() => { updateScrollButtons(); }, [updateScrollButtons]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);
  useEffect(() => { adjustHeight(); }, [adjustHeight]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    const behavior = isFirstRender.current ? "instant" : "smooth";
    isFirstRender.current = false;
    bottomRef.current?.scrollIntoView({ behavior });
    setTimeout(updateScrollButtons, 120);
  }, [messages, updateScrollButtons]);

  const prevStatus = useRef(status);
  useEffect(() => {
    const wasStreaming = prevStatus.current === "streaming";
    const nowReady = status === "ready";
    if (wasStreaming && nowReady && messages.length > 0) {
      const toSave = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(toTrainerMessage)
        .filter((m) => m.content);
      if (toSave.length > 0) saveTrainerHistory(threadId, toSave).catch(console.error);
    }
    prevStatus.current = status;
  }, [status, messages, threadId]);

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
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    },
    [handleSend]
  );

  const isGeneralChat = activityId === "general";
  const lastMsgId = messages[messages.length - 1]?.id;

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
          onClick={onOpenThreads}
          className="flex items-center justify-center w-10 h-10 text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-lg transition-all duration-200 cursor-pointer md:hidden"
          title="Threads"
        >
          <Menu className="w-4 h-4" />
        </button>
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-2 sm:py-1.5 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-lg transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{isGeneralChat ? "Back" : "Activity"}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-[#f1f5f9]">
            {isGeneralChat ? "Cycling Coach" : "AI Trainer"}
          </span>
          <span className="truncate text-xs text-[#94a3b8]">
            {status === "submitted" && "Sending…"}
            {status === "streaming" && "Responding…"}
            {(status === "ready" || status === "error") && "Kimi 2.5 via OpenRouter"}
          </span>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-auto sm:flex sm:items-center">
          <button
            onClick={handleCompact}
            disabled={compactState === "loading" || isLoading || messages.length === 0}
            title="Fork and compact conversation with Kimi K2.5"
            className={`flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg border transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
              compactState === "done"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : compactState === "error"
                ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                : compactState === "loading"
                ? "bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#c4b5fd] cursor-wait"
                : "bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#c4b5fd] hover:bg-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span className="truncate">
              {compactState === "loading" && "Compacting…"}
              {compactState === "done" && "Compacted!"}
              {compactState === "error" && (compactError ?? "Error")}
              {compactState === "idle" && "Compact"}
            </span>
          </button>

          {isGeneralChat && (
            <button
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

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const isLastMsg = msg.id === lastMsgId;
            const isCurrentlyStreaming = isLastMsg && status === "streaming";

            if (isUser) {
              const text = getTextContent(msg);
              if (!text) return null;
              return (
                <div key={msg.id} className="flex flex-col items-end gap-1">
                  <div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
                    {text}
                  </div>
                  <span className="text-[10px] text-[#4a4468] pr-1">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
              );
            }

            const thinkingContent = getThinkingContent(msg);
            const textContent = getTextContent(msg);
            const isThinkingPhase = isCurrentlyStreaming && !!thinkingContent && !textContent;

            return (
              <div key={msg.id} className="flex flex-col items-start gap-1">
                <div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd] [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
                  {thinkingContent && (
                    <ThinkingBlock content={thinkingContent} isStreaming={isThinkingPhase} />
                  )}
                  {textContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
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
                  <span className="text-[10px] text-[#4a4468] pl-1">
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
                onClick={scrollToTop}
                title="Scroll to top"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] hover:border-[rgba(139,92,246,0.4)] text-[#7c6fa0] hover:text-[#c4b5fd] transition-all duration-200 cursor-pointer backdrop-blur-sm shadow-lg"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
            {showScrollBottom && (
              <button
                onClick={scrollToBottom}
                title="Scroll to bottom"
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a1533]/90 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.2)] hover:border-[rgba(139,92,246,0.4)] text-[#7c6fa0] hover:text-[#c4b5fd] transition-all duration-200 cursor-pointer backdrop-blur-sm shadow-lg"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-6 sm:pt-3 border-t border-[rgba(139,92,246,0.1)] bg-[#0f0b1a] shrink-0">
        <div className="flex gap-2 sm:gap-3 items-end bg-[#1a1533]/60 border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2.5 sm:px-4 sm:py-3">
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
          {isLoading ? (
            <button
              onClick={stop}
              title="Stop generation"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-400 transition-all duration-200 cursor-pointer shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
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
  );
}

// ─── TrainerView ──────────────────────────────────────────────────────────────

export function TrainerView({ initialMessage, activityId, onBack }: TrainerViewProps) {
  const [threads, setThreads] = useState<TrainerThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [currentInitialInput, setCurrentInitialInput] = useState(initialMessage);
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
        const latest = list.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
        setActiveThreadId(latest.id);
      }
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [activityId]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // When active thread changes, load its messages
  useEffect(() => {
    if (!activeThreadId) {
      setInitialMessages(null);
      return;
    }
    setInitialMessages(null);
    fetchTrainerHistory(activeThreadId)
      .then((h) => setInitialMessages(h.messages.map(toUIMessage)))
      .catch(() => setInitialMessages([]));
  }, [activeThreadId]);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
    setCurrentInitialInput(""); // only pre-fill on first open
  }, []);

  const handleCreateThread = useCallback(async () => {
    const name = `Thread ${threads.length + 1}`;
    const thread = await createThread(activityId, name);
    setThreads((prev) => [...prev, thread]);
    setActiveThreadId(thread.id);
    setCurrentInitialInput("");
  }, [activityId, threads.length]);

  const handleRenameThread = useCallback(async (threadId: string, name: string) => {
    await renameThread(threadId, name);
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, name } : t)));
  }, []);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    await deleteThread(threadId);
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);
      if (activeThreadId === threadId) {
        setActiveThreadId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeThreadId]);

  const handleImported = useCallback(() => {
    if (!activeThreadId) return;
    setInitialMessages(null);
    fetchTrainerHistory(activeThreadId)
      .then((h) => {
        setInitialMessages(h.messages.map(toUIMessage));
        setChatKey((k) => k + 1);
      })
      .catch(() => setInitialMessages([]));
  }, [activeThreadId]);

  const handleCompacted = useCallback((newThread: TrainerThread) => {
    setThreads((prev) => [...prev, newThread]);
    setActiveThreadId(newThread.id);
    // activeThreadId change triggers the useEffect to fetch new thread's messages
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
        onCompacted={handleCompacted}
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
