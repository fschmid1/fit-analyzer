import { memo } from "react";
import type { UIMessage } from "@tanstack/ai-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock } from "./ThinkingBlock";
import { DotsLoader } from "./DotsLoader";
import { MessageActions } from "./MessageActions";
import {
	getTextContent,
	getThinkingContent,
	formatTime,
} from "./trainerHelpers";
import { mdComponents } from "./markdownComponents";

interface ChatMessageRowProps {
	msg: UIMessage;
	msgIndex: number;
	isLastMsg: boolean;
	isCurrentlyStreaming: boolean;
	onDelete: (messageId: string) => void;
	onRetry: (msgIndex: number) => void;
}

function ChatMessageRowInner({
	msg,
	msgIndex,
	isCurrentlyStreaming,
	onDelete,
	onRetry,
}: ChatMessageRowProps) {
	const isUser = msg.role === "user";
	const text = getTextContent(msg);
	const thinkingContent = getThinkingContent(msg);
	const isThinkingPhase = isCurrentlyStreaming && !!thinkingContent && !text;

	if (isUser) {
		if (!text) return null;
		return (
			<div className="flex flex-col items-end gap-1">
				<div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#e2d9f3] whitespace-pre-wrap [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
					{text}
				</div>
				<div className="flex items-center gap-2 pr-1">
					<MessageActions
						msg={msg}
						isCurrentlyStreaming={isCurrentlyStreaming}
						onDelete={() => onDelete(msg.id)}
						onRetry={() => onRetry(msgIndex)}
						canRetry={true}
					/>
					<span className="text-[10px] text-[#4a4468]">
						{formatTime(msg.createdAt)}
					</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-start gap-1">
			<div className="min-w-0 max-w-[calc(100%-1rem)] overflow-hidden rounded-lg px-3 py-2.5 text-sm leading-relaxed break-words bg-[#1a1533]/80 border border-[rgba(139,92,246,0.1)] text-[#c4b5fd] [overflow-wrap:anywhere] sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-base">
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
			<div className="flex items-center gap-2 pl-1">
				<MessageActions
					msg={msg}
					isCurrentlyStreaming={isCurrentlyStreaming}
					onDelete={() => onDelete(msg.id)}
					onRetry={() => onRetry(msgIndex)}
					canRetry={true}
				/>
				{!isCurrentlyStreaming && text && (
					<span className="text-[10px] text-[#4a4468]">
						{formatTime(msg.createdAt)}
					</span>
				)}
			</div>
		</div>
	);
}

export const ChatMessageRow = memo(ChatMessageRowInner);
