import { useState, useMemo } from "react";
import { Clipboard, Check, BotMessageSquare } from "lucide-react";
import type { ActivitySummary, Interval } from "@fit-analyzer/shared";
import { formatCopyBoxText } from "../lib/formatters";

interface CopyBoxProps {
  summary: ActivitySummary;
  intervals: Interval[];
  onSendToTrainer: (text: string) => void;
}

export function CopyBox({ summary, intervals, onSendToTrainer }: CopyBoxProps) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(
    () => formatCopyBoxText(summary, intervals),
    [summary, intervals]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
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

  return (
    <div className="mx-6 mb-6">
      <div className="relative bg-[#0d0919] border border-[rgba(139,92,246,0.15)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1533]/50 border-b border-[rgba(139,92,246,0.1)]">
          <p className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
            Activity Summary
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSendToTrainer(text)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 cursor-pointer bg-[#8b5cf6]/10 text-[#8b5cf6] hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
            >
              <BotMessageSquare className="w-3.5 h-3.5" />
              Send to Trainer
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 cursor-pointer ${
                copied
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-[#8b5cf6]/10 text-[#8b5cf6] hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Clipboard className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
        <pre className="p-4 text-sm font-mono text-[#c4b5fd] leading-relaxed overflow-x-auto select-all">
          {text}
        </pre>
      </div>
    </div>
  );
}
