import { useEffect, useRef, useState, useCallback } from "react";
import { useChat } from "@tanstack/ai-react";
import { fetchServerSentEvents } from "@tanstack/ai-client";
import { ArrowLeft, Send, Square } from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";

interface TrainerViewProps {
  initialMessage: string;
  onBack: () => void;
}

/** Extract all text content from a UIMessage's parts */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.content)
    .join("");
}

const connection = fetchServerSentEvents("/api/trainer/chat");

export function TrainerView({ initialMessage, onBack }: TrainerViewProps) {
  const { messages, sendMessage, isLoading, stop } = useChat({ connection });
  const [input, setInput] = useState(initialMessage);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasMounted = useRef(false);

  // Auto-grow textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Pre-fill input on mount (only once)
  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    if (initialMessage) {
      setInput(initialMessage);
    }
  }, [initialMessage]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage(text);
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-73px)]">
      {/* Sub-header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[rgba(139,92,246,0.1)] bg-[#0f0b1a]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Activity
        </button>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[#f1f5f9]">
            AI Trainer
          </span>
          <span className="text-xs text-[#94a3b8]">
            Kimi 2.5 via OpenRouter
          </span>
        </div>
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
          const text = getMessageText(msg);
          if (!text && msg.role !== "assistant") return null;

          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  isUser
                    ? "bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3]"
                    : "bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd]"
                }`}
              >
                {text || (
                  /* streaming placeholder — show dots while assistant message is empty */
                  <span className="flex gap-1 items-center h-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Streaming indicator — shown when loading but no assistant message yet */}
        {isLoading &&
          !messages.some(
            (m) => m.role === "assistant" && getMessageText(m) === ""
          ) && (
            <div className="flex justify-start">
              <div className="bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] rounded-2xl px-4 py-3">
                <span className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] animate-bounce [animation-delay:300ms]" />
                </span>
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
              disabled={!input.trim()}
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
