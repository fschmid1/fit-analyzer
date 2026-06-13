import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

interface HighlightChartDisplay {
	activityId: string;
	startSeconds: number;
	endSeconds: number;
	label?: string;
	color?: string;
}

function formatElapsed(seconds: number): string {
	const total = Math.max(0, Math.round(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0)
		return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function HighlightChartInner({ display }: { display: HighlightChartDisplay }) {
	const navigate = useNavigate();
	const duration = Math.max(0, display.endSeconds - display.startSeconds);
	const isValid =
		typeof display.activityId === "string" &&
		display.activityId.length > 0 &&
		Number.isFinite(display.startSeconds) &&
		Number.isFinite(display.endSeconds) &&
		display.endSeconds >= display.startSeconds;

	const handleClick = () => {
		if (!isValid) return;
		navigate(`/activity/${display.activityId}`);
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={!isValid}
			className="flex items-center gap-2 text-[11px] cursor-pointer hover:opacity-80 transition-opacity text-left disabled:cursor-not-allowed disabled:opacity-50"
		>
			<span className="text-[#7c6fa0]">Range:</span>
			<span className="text-[#c4b5fd] font-medium">
				{formatElapsed(display.startSeconds)} –{" "}
				{formatElapsed(display.endSeconds)}
			</span>
			<span className="text-[#7c6fa0]">
				({Math.floor(duration / 60)}m {Math.round(duration % 60)}s)
			</span>
			{display.label && (
				<span className="text-[#8b5cf6] font-medium">· {display.label}</span>
			)}
			{isValid && (
				<span className="text-[#8b5cf6] text-[10px]">→ View on chart</span>
			)}
		</button>
	);
}

export function renderHighlightChart(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as HighlightChartDisplay;
	if (
		typeof d.startSeconds !== "number" ||
		typeof d.endSeconds !== "number" ||
		d.endSeconds < d.startSeconds
	)
		return null;

	return <HighlightChartInner display={d} />;
}
