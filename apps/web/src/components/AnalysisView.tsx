import type { ParsedActivity, Interval } from "@fit-analyzer/shared";
import { StatsBar } from "./StatsBar";
import { ActivityChart } from "./ActivityChart";
import { IntervalList } from "./IntervalList";
import { SummaryCards } from "./SummaryCards";
import { CopyBox } from "./CopyBox";

interface AnalysisViewProps {
	activity: ParsedActivity;
	selectionRange: [number, number] | null;
	chartZoom: [number, number] | null;
	chartIntervalRanges: [number, number][];
	allIntervals: Interval[];
	customIntervals: [number, number][];
	savedIntervalMinutes: string;
	onSelectionChange: (range: [number, number] | null) => void;
	onIntervalClick: (startSeconds: number, endSeconds: number) => void;
	onIntervalsChange: (intervals: Interval[]) => void;
	onIntervalMinutesChange: (minutes: string) => void;
	onAddInterval: (startSeconds: number, endSeconds: number) => void;
	onRemoveCustomInterval: (index: number) => void;
	onSendToTrainer: (text: string) => void;
}

export function AnalysisView({
	activity,
	selectionRange,
	chartZoom,
	chartIntervalRanges,
	allIntervals,
	customIntervals,
	savedIntervalMinutes,
	onSelectionChange,
	onIntervalClick,
	onIntervalsChange,
	onIntervalMinutesChange,
	onAddInterval,
	onRemoveCustomInterval,
	onSendToTrainer,
}: AnalysisViewProps) {
	return (
		<div className="flex-1 flex flex-col overflow-y-auto pt-6 animate-[fadeIn_0.4s_ease-out]">
			<div className="px-6 mb-4">
				<h2 className="text-2xl font-bold text-[#f1f5f9]">
					Activity on {activity.summary.date}
				</h2>
				<p className="text-sm text-[#94a3b8] mt-1">
					{activity.records.length.toLocaleString()} data points recorded
				</p>
			</div>

			<StatsBar records={activity.records} selectionRange={selectionRange} />

			<ActivityChart
				records={activity.records}
				onSelectionChange={onSelectionChange}
				externalZoom={chartZoom}
				intervalRanges={chartIntervalRanges}
				onAddInterval={onAddInterval}
			/>

			<IntervalList
				records={activity.records}
				laps={activity.laps}
				onIntervalClick={onIntervalClick}
				onIntervalsChange={onIntervalsChange}
				onIntervalMinutesChange={onIntervalMinutesChange}
				customIntervals={customIntervals}
				onRemoveCustomInterval={onRemoveCustomInterval}
				initialIntervalMinutes={savedIntervalMinutes}
			/>

			<SummaryCards summary={activity.summary} />

			<CopyBox
				summary={activity.summary}
				intervals={allIntervals}
				onSendToTrainer={onSendToTrainer}
			/>
		</div>
	);
}
