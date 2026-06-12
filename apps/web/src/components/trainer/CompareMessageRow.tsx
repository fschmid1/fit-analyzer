import { memo } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import type { UIToolCall } from "@fit-analyzer/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock } from "./ThinkingBlock";
import { DotsLoader } from "./DotsLoader";
import { ToolCallCard } from "./ToolCallCard";
import {
	getTextContent,
	getThinkingContent,
	formatTime,
} from "./trainerHelpers";
import { mdComponents } from "./markdownComponents";

interface CompareMessageRowProps {
	msg: UIMessage;
	isLastMsg: boolean;
	isCurrentlyStreaming: boolean;
	toolCalls?: UIToolCall[];
}

function CompareMessageRowInner({
	msg,
	isCurrentlyStreaming,
	toolCalls,
}: CompareMessageRowProps) {
	const isUser = msg.role === "user";
	const text = getTextContent(msg);
	const thinkingContent = getThinkingContent(msg);
	const isThinkingPhase = isCurrentlyStreaming && !!thinkingContent && !text;

	if (isUser) {
		if (!text) return null;
		return (
			<div className="flex flex-col items-end gap-1">
				<div className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap [overflow-wrap:anywhere]">
					{text}
				</div>
				<span className="text-[10px] text-[#4a4468]">
					{formatTime(msg.createdAt)}
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-start gap-1">
			{toolCalls && toolCalls.length > 0 && (
				<div className="ml-2 flex w-full max-w-[calc(100%-1.5rem)] flex-col gap-1.5">
					{toolCalls.map((tc) => (
						<ToolCallCard key={tc.id} toolCall={tc} />
					))}
				</div>
			)}
			<div className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-sm leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd] [overflow-wrap:anywhere]">
				{thinkingContent && (
					<ThinkingBlock
						content={thinkingContent}
						isStreaming={isThinkingPhase}
					/>
				)}
				{text ? (
					<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
						{text}
					</ReactMarkdown>
				) : isCurrentlyStreaming && !thinkingContent ? (
					<DotsLoader />
				) : null}
				{isCurrentlyStreaming && text && (
					<span className="inline-block w-0.5 h-4 bg-[#8b5cf6] animate-pulse ml-0.5 align-middle" />
				)}
			</div>
			{!isCurrentlyStreaming && text && (
				<span className="text-[10px] text-[#4a4468]">
					{formatTime(msg.createdAt)}
				</span>
			)}
		</div>
	);
}

export const CompareMessageRow = memo(CompareMessageRowInner);
