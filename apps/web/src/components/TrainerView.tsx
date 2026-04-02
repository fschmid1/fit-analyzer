import { useEffect, useRef, useState, useCallback } from "react";
import { useChat } from "@tanstack/ai-react";
import { fetchServerSentEvents } from "@tanstack/ai-client";
import { ArrowLeft, Brain, ChevronDown, ChevronRight, Send, Square, Upload } from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";
import type { TrainerMessage } from "@fit-analyzer/shared";
import { fetchTrainerHistory, importTrainerChat, saveTrainerHistory } from "../lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TrainerViewProps {
  initialMessage: string;
  activityId: string;
  onBack: () => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── sub-components ──────────────────────────────────────────────────────────

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
    <div className="overflow-x-auto my-2">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#8b5cf6]/10">{children}</thead>,
  th: ({ children }) => <th className="border border-[rgba(139,92,246,0.2)] px-2 py-1.5 text-left font-semibold text-[#e2d9f3]">{children}</th>,
  td: ({ children }) => <td className="border border-[rgba(139,92,246,0.15)] px-2 py-1.5 text-[#c4b5fd]">{children}</td>,
  tr: ({ children }) => <tr className="even:bg-[#8b5cf6]/5">{children}</tr>,
};

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

  // Auto-open while streaming, collapse when done
  useEffect(() => {
    if (isStreaming) setOpen(true);
    else setOpen(false);
  }, [isStreaming]);

  return (
    <div className="mb-3 rounded-xl border border-[rgba(139,92,246,0.15)] bg-[#0f0b1a]/60 overflow-hidden">
      <button
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

// Stable module-level connection — recreating on every render would cancel in-flight streams
const connection = fetchServerSentEvents("/api/trainer/chat");

// ─── inner chat ──────────────────────────────────────────────────────────────

interface TrainerChatProps {
  initialMessages: UIMessage[];
  initialInput: string;
  activityId: string;
  onBack: () => void;
  onImported: () => void;
}

function TrainerChat({ initialMessages, initialInput, activityId, onBack, onImported }: TrainerChatProps) {
  const { messages, sendMessage, status, isLoading, stop, error } = useChat({
    connection,
    initialMessages,
  });

  const inputRef = useRef(initialInput);
  const [hasInput, setHasInput] = useState(!!initialInput.trim());
  const [importState, setImportState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after an error
    e.target.value = "";
    setImportState("loading");
    setImportError(null);
    try {
      await importTrainerChat(file);
      setImportState("done");
      setTimeout(() => setImportState("idle"), 3000);
      onImported();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
      setImportState("error");
      setTimeout(() => setImportState("idle"), 5000);
    }
  }, [onImported]);

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);
  // Run once on mount to size the textarea for any pre-filled initialInput
  useEffect(() => { adjustHeight(); }, [adjustHeight]);

  // Scroll to bottom — instant on first render, smooth for new content
  const isFirstRender = useRef(true);
  useEffect(() => {
    const behavior = isFirstRender.current ? "instant" : "smooth";
    isFirstRender.current = false;
    bottomRef.current?.scrollIntoView({ behavior });
  }, [messages]);

  // Save to DB when a response finishes (status: streaming → ready)
  const prevStatus = useRef(status);
  useEffect(() => {
    const wasStreaming = prevStatus.current === "streaming";
    const nowReady = status === "ready";
    if (wasStreaming && nowReady && messages.length > 0) {
      const toSave = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map(toTrainerMessage)
        .filter((m) => m.content); // skip empty assistant placeholders
      if (toSave.length > 0) saveTrainerHistory(activityId, toSave).catch(console.error);
    }
    prevStatus.current = status;
  }, [status, messages, activityId]);

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
    [handleSend]
  );

  const isGeneralChat = activityId === "general";
  const lastMsgId = messages[messages.length - 1]?.id;

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-73px)]">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Sub-header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {isGeneralChat ? "Back" : "Back to Activity"}
        </button>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[#f1f5f9]">
            {isGeneralChat ? "Cycling Coach" : "AI Trainer"}
          </span>
          <span className="text-xs text-[#94a3b8]">
            {status === "submitted" && "Sending…"}
            {status === "streaming" && "Responding…"}
            {(status === "ready" || status === "error") && "Kimi 2.5 via OpenRouter"}
          </span>
        </div>

        {/* Import button — only in the general coaching chat */}
        {isGeneralChat && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importState === "loading"}
            title="Import ChatGPT markdown export"
            className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-all duration-200 cursor-pointer disabled:cursor-wait ${
              importState === "done"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : importState === "error"
                ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                : "bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#c4b5fd] hover:bg-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {importState === "loading" && "Importing…"}
            {importState === "done" && "Imported!"}
            {importState === "error" && (importError ?? "Error")}
            {importState === "idle" && "Import .md"}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-50">
            <div className="w-12 h-12 rounded-2xl bg-[#8b5cf6]/20 flex items-center justify-center">
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
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl px-4 py-3 text-base leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap">
                  {text}
                </div>
              </div>
            );
          }

          // Assistant message
          const thinkingContent = getThinkingContent(msg);
          const textContent = getTextContent(msg);
          const isThinkingPhase = isCurrentlyStreaming && !!thinkingContent && !textContent;

          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-base leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd]">
                {/* Thinking block */}
                {thinkingContent && (
                  <ThinkingBlock
                    content={thinkingContent}
                    isStreaming={isThinkingPhase}
                  />
                )}

                {/* Response text */}
                {textContent ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {textContent}
                  </ReactMarkdown>
                ) : isCurrentlyStreaming && !thinkingContent ? (
                  // Waiting for first tokens and no thinking yet
                  <DotsLoader />
                ) : null}

                {/* Streaming cursor on last token */}
                {isCurrentlyStreaming && textContent && (
                  <span className="inline-block w-0.5 h-4 bg-[#8b5cf6] animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          );
        })}

        {/* Submitted but no assistant message started yet */}
        {status === "submitted" && (
          <div className="flex justify-start">
            <div className="bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] rounded-2xl px-4 py-3">
              <DotsLoader />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400">
              Error: {error.message}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-6 pb-6 pt-3 border-t border-[rgba(139,92,246,0.1)] bg-[#0f0b1a]">
        <div className="flex gap-3 items-end bg-[#1a1533]/60 border border-[rgba(139,92,246,0.15)] rounded-2xl px-4 py-3">
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
            placeholder="Ask your trainer about this activity… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-[#f1f5f9] placeholder-[#4a4468] outline-none leading-relaxed"
            style={{ maxHeight: "200px" }}
          />
          {isLoading ? (
            <button
              onClick={stop}
              title="Stop generation"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-400 transition-all duration-200 cursor-pointer shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!hasInput}
              title="Send message"
              className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#8b5cf6]/20 hover:bg-[#8b5cf6]/30 border border-[#8b5cf6]/30 text-[#8b5cf6] transition-all duration-200 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── outer wrapper — loads history then mounts TrainerChat ───────────────────

export function TrainerView({ initialMessage, activityId, onBack }: TrainerViewProps) {
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [chatKey, setChatKey] = useState(0);

  const loadHistory = useCallback(() => {
    setInitialMessages(null);
    fetchTrainerHistory(activityId)
      .then((h) => setInitialMessages(h.messages.map(toUIMessage)))
      .catch(() => setInitialMessages([]));
  }, [activityId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Called after a successful import — re-fetch history and remount the chat
  const handleImported = useCallback(() => {
    setInitialMessages(null);
    fetchTrainerHistory(activityId)
      .then((h) => {
        setInitialMessages(h.messages.map(toUIMessage));
        setChatKey((k) => k + 1);
      })
      .catch(() => setInitialMessages([]));
  }, [activityId]);

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
      key={`${activityId}-${chatKey}`}
      initialMessages={initialMessages}
      initialInput={initialMessage}
      activityId={activityId}
      onBack={onBack}
      onImported={handleImported}
    />
  );
}
