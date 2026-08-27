import { Loader2, X } from "lucide-react";
import type { TrainerAttachmentRef } from "@fit-analyzer/shared";

export interface PendingAttachment {
	id: string;
	file: File;
	previewUrl: string;
	status: "processing" | "uploading" | "ready" | "error";
	ref?: TrainerAttachmentRef;
	error?: string;
}

interface PendingAttachmentStripProps {
	pending: PendingAttachment[];
	onRemove: (id: string) => void;
	onRetry: (id: string) => void;
}

export function PendingAttachmentStrip({
	pending,
	onRemove,
	onRetry,
}: PendingAttachmentStripProps) {
	if (pending.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 pb-2">
			{pending.map((p) => (
				<div
					key={p.id}
					className="relative w-16 h-16 rounded-md overflow-hidden border border-[rgba(139,92,246,0.2)] bg-black/30"
				>
					<img
						src={p.previewUrl}
						alt={p.file.name}
						className="w-full h-full object-cover"
					/>
					{(p.status === "processing" || p.status === "uploading") && (
						<div className="absolute inset-0 flex items-center justify-center bg-black/50">
							<Loader2 className="w-4 h-4 text-white animate-spin" />
						</div>
					)}
					{p.status === "error" && (
						<button
							type="button"
							onClick={() => onRetry(p.id)}
							className="absolute inset-0 flex items-center justify-center bg-rose-500/60 text-white text-[10px] text-center px-1 cursor-pointer"
						>
							{p.error ?? "Failed · retry"}
						</button>
					)}
					<button
						type="button"
						onClick={() => onRemove(p.id)}
						className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/70 hover:bg-black/90 text-white cursor-pointer"
					>
						<X className="w-2.5 h-2.5" />
					</button>
				</div>
			))}
		</div>
	);
}
