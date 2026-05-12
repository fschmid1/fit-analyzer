import { useState, useEffect } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { DotsLoader } from "./DotsLoader";

export function ThinkingBlock({
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
