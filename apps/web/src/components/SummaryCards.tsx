import {
	Zap,
	Heart,
	Gauge,
	Clock,
	TrendingUp,
	Flame,
	Route,
} from "lucide-react";
import { MetricCard } from "./MetricCard";
import { formatElapsedTime } from "../lib/formatters";
import { findPeakPowerWindow } from "../lib/stats";
import type { ActivityRecord, ActivitySummary } from "@fit-analyzer/shared";

interface SummaryCardsProps {
	summary: ActivitySummary;
	records: ActivityRecord[];
	onPeakClick?: (windowSeconds: number) => void;
}

interface CardConfig {
	icon: typeof TrendingUp;
	label: string;
	value: string | number;
	unit: string;
	subValue?: string;
	color: string;
	onClick?: () => void;
}

export function SummaryCards({
	summary,
	records,
	onPeakClick,
}: SummaryCardsProps) {
	const peak1minWindow = onPeakClick ? findPeakPowerWindow(records, 60) : null;
	const peak5minWindow = onPeakClick ? findPeakPowerWindow(records, 300) : null;
	const peak20minWindow = onPeakClick
		? findPeakPowerWindow(records, 1200)
		: null;

	const cards: CardConfig[] = [
		{
			icon: Clock,
			label: "Duration",
			value: formatElapsedTime(summary.totalTimerTime),
			unit: "",
			color: "#a78bfa",
		},
		{
			icon: Route,
			label: "Distance",
			value: summary.totalDistanceKm ?? "N/A",
			unit: summary.totalDistanceKm !== null ? "km" : "",
			color: "#22c55e",
		},
		{
			icon: Zap,
			label: "Avg Power",
			value: summary.avgPower ?? "N/A",
			unit: summary.avgPower !== null ? "W" : "",
			subValue:
				summary.maxPower !== null ? `Max: ${summary.maxPower} W` : undefined,
			color: "#8b5cf6",
		},
		{
			icon: Zap,
			label: "Normalized Power",
			value: summary.normalizedPower ?? "N/A",
			unit: summary.normalizedPower !== null ? "W" : "",
			color: "#a855f7",
		},
		{
			icon: Heart,
			label: "Avg Heart Rate",
			value: summary.avgHeartRate ?? "N/A",
			unit: summary.avgHeartRate !== null ? "bpm" : "",
			subValue:
				summary.maxHeartRate !== null
					? `Max: ${summary.maxHeartRate} bpm`
					: undefined,
			color: "#ef4444",
		},
		{
			icon: Gauge,
			label: "Avg Cadence",
			value: summary.avgCadence ?? "N/A",
			unit: summary.avgCadence !== null ? "rpm" : "",
			color: "#06b6d4",
		},
		{
			icon: Gauge,
			label: "Normalized Cadence",
			value: summary.normalizedCadence ?? "N/A",
			unit: summary.normalizedCadence !== null ? "rpm" : "",
			color: "#06b6d4",
		},
		{
			icon: TrendingUp,
			label: "Peak 1min Power",
			value: summary.peak1minPower ?? "N/A",
			unit: summary.peak1minPower !== null ? "W" : "",
			subValue: peak1minWindow
				? `${formatElapsedTime(peak1minWindow.startSeconds)}–${formatElapsedTime(peak1minWindow.endSeconds)}`
				: undefined,
			color: "#f59e0b",
			onClick: peak1minWindow ? () => onPeakClick?.(60) : undefined,
		},
		{
			icon: TrendingUp,
			label: "Peak 5min Power",
			value: summary.peak5minPower ?? "N/A",
			unit: summary.peak5minPower !== null ? "W" : "",
			subValue: peak5minWindow
				? `${formatElapsedTime(peak5minWindow.startSeconds)}–${formatElapsedTime(peak5minWindow.endSeconds)}`
				: undefined,
			color: "#f97316",
			onClick: peak5minWindow ? () => onPeakClick?.(300) : undefined,
		},
		{
			icon: TrendingUp,
			label: "Peak 20min Power",
			value: summary.peak20minPower ?? "N/A",
			unit: summary.peak20minPower !== null ? "W" : "",
			subValue: peak20minWindow
				? `${formatElapsedTime(peak20minWindow.startSeconds)}–${formatElapsedTime(peak20minWindow.endSeconds)}`
				: undefined,
			color: "#ea580c",
			onClick: peak20minWindow ? () => onPeakClick?.(1200) : undefined,
		},
		{
			icon: Flame,
			label: "Total Work",
			value:
				summary.totalWork !== null
					? Math.round(summary.totalWork / 1000)
					: "N/A",
			unit: summary.totalWork !== null ? "kJ" : "",
			color: "#ec4899",
		},
	];

	return (
		<div className="px-6 pb-6">
			<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
				{cards.map((card) => (
					<MetricCard key={card.label} {...card} />
				))}
			</div>
		</div>
	);
}
