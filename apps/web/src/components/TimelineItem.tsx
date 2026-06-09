import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useSpringScale } from "../lib/useGestureSpring";
import { animated } from "@react-spring/web";

interface TimelineItemProps {
	icon: LucideIcon;
	title: string;
	subtitle: string;
	badge?: string;
	badgeColor?: string;
	onClick?: () => void;
}

export function TimelineItem({
	icon: Icon,
	title,
	subtitle,
	badge,
	badgeColor = "#8b5cf6",
	onClick,
}: TimelineItemProps) {
	const pressGesture = useSpringScale({ scaleDown: 0.97 });

	return (
		<animated.div
			{...pressGesture}
			onClick={onClick}
			className={`flex items-center gap-4 p-4 bg-[#1a1f2e] border border-[rgba(255,255,255,0.06)] rounded-2xl ${onClick ? "cursor-pointer" : "cursor-default"}`}
		>
			<div
				className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
				style={{ backgroundColor: `${badgeColor}20` }}
			>
				<Icon className="w-5 h-5" style={{ color: badgeColor }} />
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-semibold text-[#f1f5f9] truncate">{title}</p>
				<p className="text-xs text-[#94a3b8] truncate">{subtitle}</p>
			</div>
			{badge && (
				<div
					className="flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-lg text-xs font-bold shrink-0"
					style={{
						backgroundColor: `${badgeColor}20`,
						color: badgeColor,
					}}
				>
					{badge}
				</div>
			)}
			{onClick && <ChevronRight className="w-4 h-4 text-[#64748b] shrink-0" />}
		</animated.div>
	);
}
