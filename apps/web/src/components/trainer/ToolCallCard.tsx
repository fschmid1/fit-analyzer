import { memo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
	Activity,
	BarChart3,
	Bike,
	Calendar,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	CloudSun,
	Globe,
	HeartPulse,
	Loader2,
	Mountain,
	Search,
	TrendingUp,
	Zap,
} from "lucide-react";
import type { UIToolCall } from "@fit-analyzer/shared";
import { renderToolDisplay } from "./toolDisplays";

interface ToolMeta {
	label: string;
	icon: LucideIcon;
	accent: string;
}

const TOOL_META: Record<string, ToolMeta> = {
	web_search: {
		label: "Web Search",
		icon: Globe,
		accent: "rgba(96, 165, 250, 0.7)", // blue
	},
	activity_lookup: {
		label: "Activity Lookup",
		icon: Search,
		accent: "rgba(139, 92, 246, 0.7)", // violet
	},
	training_load: {
		label: "Training Load",
		icon: TrendingUp,
		accent: "rgba(52, 211, 153, 0.7)", // emerald
	},
	weather_history: {
		label: "Weather History",
		icon: CloudSun,
		accent: "rgba(251, 191, 36, 0.7)", // amber
	},
	power_curve: {
		label: "Power Curve",
		icon: Zap,
		accent: "rgba(244, 114, 182, 0.7)", // pink
	},
	event_countdown: {
		label: "Event Countdown",
		icon: Calendar,
		accent: "rgba(45, 212, 191, 0.7)", // teal
	},

	zone_analysis: {
		label: "Zone Analysis",
		icon: BarChart3,
		accent: "rgba(34, 197, 94, 0.7)", // green
	},
	analyze_intervals: {
		label: "Analyze Intervals",
		icon: Activity,
		accent: "rgba(251, 146, 60, 0.7)", // orange
	},
	compare_activities: {
		label: "Compare Activities",
		icon: Search,
		accent: "rgba(96, 165, 250, 0.7)", // blue
	},
	segment_finder: {
		label: "Segment Finder",
		icon: Mountain,
		accent: "rgba(163, 230, 53, 0.7)", // lime
	},
	trend_analysis: {
		label: "Trend Analysis",
		icon: TrendingUp,
		accent: "rgba(96, 165, 250, 0.7)", // blue
	},
	workout_generator: {
		label: "Workout Generator",
		icon: Activity,
		accent: "rgba(251, 146, 60, 0.7)", // orange
	},
	cardiac_drift: {
		label: "Cardiac Drift",
		icon: HeartPulse,
		accent: "rgba(248, 113, 113, 0.7)", // red
	},
	ride_recommendation: {
		label: "Ride Recommendation",
		icon: Bike,
		accent: "rgba(52, 211, 153, 0.7)", // emerald
	},
};

function metaFor(name: string): ToolMeta {
	return (
		TOOL_META[name] ?? {
			label: name,
			icon: Search,
			accent: "rgba(139, 92, 246, 0.7)",
		}
	);
}

function summarizeArgs(args: Record<string, unknown>): string {
	const keys = Object.keys(args);
	if (keys.length === 0) return "";
	const first = keys[0];
	const value = args[first];
	if (typeof value === "string") {
		return value.length > 80 ? `${value.slice(0, 77)}…` : value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return `${first}: ${String(value)}`;
	}
	return `${keys.length} argument${keys.length === 1 ? "" : "s"}`;
}

function renderDisplay(display: unknown): string {
	if (display == null) return "";
	if (typeof display === "string") return display;
	if (Array.isArray(display)) {
		return display
			.map((item) => {
				if (item && typeof item === "object") {
					const obj = item as Record<string, unknown>;
					const text = (obj.text ?? obj.name ?? "") as string;
					const url = (obj.url ?? obj.uri ?? "") as string;
					return url ? `${text} (${url})` : text;
				}
				return String(item);
			})
			.filter(Boolean)
			.join("\n");
	}
	if (typeof display === "object") {
		try {
			return JSON.stringify(display, null, 2);
		} catch {
			return "";
		}
	}
	return String(display);
}

interface ToolCallCardProps {
	toolCall: UIToolCall;
	defaultExpanded?: boolean;
}

function ToolCallCardInner({ toolCall, defaultExpanded }: ToolCallCardProps) {
	const meta = metaFor(toolCall.name);
	const Icon = meta.icon;
	const isExecuting = toolCall.status === "executing";
	const isError = toolCall.status === "error";
	const [expanded, setExpanded] = useState(!!defaultExpanded);

	const summary = summarizeArgs(toolCall.arguments);
	const displayText = toolCall.result
		? renderDisplay(toolCall.result.display)
		: "";

	const richDisplay =
		toolCall.result && !isError
			? renderToolDisplay(toolCall.name, toolCall.result.display)
			: null;

	return (
		<div className="text-xs text-[#c4b5fd]">
			<button
				type="button"
				onClick={() => !isExecuting && setExpanded((v) => !v)}
				className="inline-flex cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-[#e2d9f3] disabled:cursor-default"
				disabled={isExecuting}
			>
				{isExecuting ? (
					<Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#c4b5fd]" />
				) : (
					<Icon className="h-3 w-3 shrink-0" style={{ color: meta.accent }} />
				)}
				<span className="font-medium">{meta.label}</span>
				{isError && (
					<CircleAlert
						className="h-3 w-3 shrink-0 text-rose-400"
						aria-label="Tool error"
					/>
				)}
				{summary && <span className="text-[#7c6fa0]">— {summary}</span>}
				<span className="ml-0.5 flex shrink-0 items-center text-[#4a4468]">
					{isExecuting ? (
						<span className="text-[10px] uppercase tracking-wide">Running</span>
					) : expanded ? (
						<ChevronDown className="h-3 w-3" />
					) : (
						<ChevronRight className="h-3 w-3" />
					)}
				</span>
			</button>

			{expanded && !isExecuting && (
				<div className="mt-1 text-[11px] text-[#c4b5fd]">
					{isError ? (
						<p className="text-rose-400">
							{toolCall.result?.error ?? "Tool call failed."}
						</p>
					) : toolCall.result ? (
						richDisplay ? (
							<div className="rounded-md bg-[#1a1533]/60 border border-[rgba(139,92,246,0.15)] px-3 py-2">
								{richDisplay}
							</div>
						) : (
							<pre className="whitespace-pre-wrap break-words font-sans leading-relaxed [overflow-wrap:anywhere]">
								{toolCall.result.content || displayText}
							</pre>
						)
					) : null}
				</div>
			)}
		</div>
	);
}

export const ToolCallCard = memo(ToolCallCardInner);
