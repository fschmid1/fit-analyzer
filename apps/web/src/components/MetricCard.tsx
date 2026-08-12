import type { LucideIcon } from "lucide-react";
import { useSpringScale } from "../lib/useGestureSpring";
import { animated } from "@react-spring/web";

interface MetricCardProps {
	icon: LucideIcon;
	label: string;
	value: string | number;
	unit: string;
	subValue?: string;
	color: string;
	onClick?: () => void;
}

export function MetricCard({
	icon: Icon,
	label,
	value,
	unit,
	subValue,
	color,
	onClick,
}: MetricCardProps) {
	const pressGesture = useSpringScale({ scaleDown: 0.97 });
	const clickable = onClick != null;

	return (
		<animated.div
			{...pressGesture}
			onClick={onClick}
			role={clickable ? "button" : undefined}
			tabIndex={clickable ? 0 : undefined}
			onKeyDown={
				clickable
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onClick?.();
							}
						}
					: undefined
			}
			className={`flex min-w-0 items-center gap-4 p-4 bg-[#1a1533]/70 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl transition-[border-color,background-color] duration-200 ${clickable ? "hover:border-[rgba(139,92,246,0.45)] hover:bg-[#1a1533]/90 cursor-pointer" : "cursor-default"}`}
		>
			<div
				className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
				style={{ backgroundColor: `${color}20` }}
			>
				<Icon className="w-5 h-5" style={{ color }} />
			</div>
			<div className="min-w-0">
				<p className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
					{label}
				</p>
				<div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
					<p className="min-w-0 text-2xl font-bold text-[#f1f5f9]">{value}</p>
					<p className="text-sm text-[#94a3b8]">{unit}</p>
				</div>
				{subValue && (
					<p className="text-xs text-[#94a3b8] mt-0.5">{subValue}</p>
				)}
			</div>
		</animated.div>
	);
}
