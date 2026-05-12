import { useState } from "react";
import { Check, Clipboard, Trash2, RefreshCw } from "lucide-react";
import type { UIMessage } from "@tanstack/ai-react";
import { getTextContent } from "./trainerHelpers";

export function MessageActions({
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
