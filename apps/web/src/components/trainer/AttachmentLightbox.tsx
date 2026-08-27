import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { TrainerAttachmentRef } from "@fit-analyzer/shared";
import { trainerAttachmentUrl } from "../../lib/api";

interface AttachmentLightboxProps {
	attachments: TrainerAttachmentRef[];
	index: number;
	onClose: () => void;
	onIndexChange: (index: number) => void;
}

export function AttachmentLightbox({
	attachments,
	index,
	onClose,
	onIndexChange,
}: AttachmentLightboxProps) {
	const touchStartX = useRef<number | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
			else if (e.key === "ArrowRight")
				onIndexChange(Math.min(attachments.length - 1, index + 1));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [attachments.length, index, onClose, onIndexChange]);

	const current = attachments[index];
	if (!current) return null;

	const onTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.touches[0]?.clientX ?? null;
	};
	const onTouchEnd = (e: React.TouchEvent) => {
		const startX = touchStartX.current;
		touchStartX.current = null;
		if (startX == null) return;
		const dx = (e.changedTouches[0]?.clientX ?? 0) - startX;
		if (Math.abs(dx) < 50) return;
		if (dx < 0) onIndexChange(Math.min(attachments.length - 1, index + 1));
		else onIndexChange(Math.max(0, index - 1));
	};

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90"
			style={{
				paddingTop: "env(safe-area-inset-top)",
				paddingBottom: "env(safe-area-inset-bottom)",
			}}
		>
			<button
				type="button"
				onClick={onClose}
				title="Close"
				aria-label="Close image viewer"
				className="absolute inset-0 z-0 cursor-default"
			/>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				title="Close"
				className="absolute top-3 right-3 z-10 flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
			>
				<X className="w-5 h-5" />
			</button>

			<div
				className="relative flex flex-1 items-center justify-center w-full max-w-full max-h-full p-4 overflow-hidden"
				onTouchStart={onTouchStart}
				onTouchEnd={onTouchEnd}
			>
				<img
					src={trainerAttachmentUrl(current.id)}
					alt={current.name}
					className="max-w-full max-h-full object-contain rounded-lg"
				/>
			</div>

			{attachments.length > 1 && (
				<div className="text-white/70 text-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]">
					{index + 1} / {attachments.length}
				</div>
			)}
		</div>,
		document.body,
	);
}
