import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { DotsLoader } from "./DotsLoader";

export function ThinkingBlock({
	content,
	isStreaming,
}: { content: string; isStreaming: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="inline-flex items-center gap-1.5 text-[11px] text-[#7c6fa0]/70 hover:text-[#a78bfa]/90 transition-colors cursor-pointer"
			>
				<Brain className="w-3 h-3 shrink-0" />
				{isStreaming ? (
					<span className="flex items-center gap-1.5">
						Thinking
						<DotsLoader />
					</span>
				) : (
					<span>Reasoning</span>
				)}
				<span>
					{open ? (
						<ChevronDown className="w-3 h-3" />
					) : (
						<ChevronRight className="w-3 h-3" />
					)}
				</span>
			</button>
			{open && content && (
				<div className="mt-1 text-xs text-[#6b5e8a] font-mono leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
					{content}
				</div>
			)}
		</div>
	);
}
