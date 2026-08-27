import type { TrainerAttachmentRef } from "@fit-analyzer/shared";
import { trainerAttachmentUrl } from "../../lib/api";

interface AttachmentGridProps {
	attachments: TrainerAttachmentRef[];
	onOpen?: (refs: TrainerAttachmentRef[], index: number) => void;
}

export function AttachmentGrid({ attachments, onOpen }: AttachmentGridProps) {
	if (attachments.length === 0) return null;
	return (
		<div className="grid grid-cols-2 gap-1.5 mb-2 max-w-[280px]">
			{attachments.map((ref, i) => (
				<button
					key={ref.id}
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onOpen?.(attachments, i);
					}}
					className="block overflow-hidden rounded-md border border-[#8b5cf6]/30 bg-black/30 cursor-pointer hover:border-[#8b5cf6]/60 transition-colors"
					style={
						ref.width && ref.height
							? { aspectRatio: `${ref.width} / ${ref.height}` }
							: { aspectRatio: "1" }
					}
				>
					<img
						src={trainerAttachmentUrl(ref.id)}
						alt={ref.name}
						loading="lazy"
						className="w-full h-full object-cover"
					/>
				</button>
			))}
		</div>
	);
}
