import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useDrag } from "@use-gesture/react";
import { Timer, Zap, Heart, Gauge, ChevronRight, X } from "lucide-react";
import type { ActivityRecord, LapMarker, Interval } from "@fit-analyzer/shared";
import { computeIntervals, computeAverages } from "../lib/stats";
import { formatElapsedTime } from "../lib/formatters";
import { saveIntervalMinutes, loadIntervalMinutes } from "../lib/storage";

interface IntervalListProps {
	records: ActivityRecord[];
	laps: LapMarker[];
	onIntervalClick: (startSeconds: number, endSeconds: number) => void;
	onIntervalsChange: (intervals: Interval[]) => void;
	onIntervalMinutesChange: (minutes: string) => void;
	customIntervals: [number, number][];
	onRemoveCustomInterval: (index: number) => void;
	initialIntervalMinutes?: string;
}

interface SwipeableIntervalRowProps {
	interval: Interval;
	activeKey: string | null;
	rowKey: string;
	onClick: () => void;
	trailing?: React.ReactNode;
}

function SwipeableIntervalRow({
	interval,
	activeKey,
	rowKey,
	onClick,
	trailing,
}: SwipeableIntervalRowProps) {
	const rowRef = useRef<HTMLDivElement>(null);

	useDrag(
		({ active, movement: [mx], direction: [dx], velocity: [vx] }) => {
			if (!rowRef.current) return;
			const minSwipe = 40;
			const velocityThreshold = 0.3;

			if (!active) {
				const shouldOpen =
					Math.abs(mx) > minSwipe || Math.abs(vx) > velocityThreshold;
				const targetX = shouldOpen && dx > 0 ? 48 : 0;
				rowRef.current.style.transition =
					"transform 0.2s cubic-bezier(0.32, 0.72, 0, 1)";
				rowRef.current.style.transform = `translateX(${targetX}px)`;
				requestAnimationFrame(() => {
					if (rowRef.current) rowRef.current.style.transition = "";
				});
			} else {
				rowRef.current.style.transition = "none";
				const clamped = Math.max(-80, Math.min(mx, 80));
				rowRef.current.style.transform = `translateX(${clamped}px)`;
			}
		},
		{
			target: rowRef,
			axis: "x",
			bounds: { left: -80, right: 80 },
			rubberband: true,
			preventDefault: true,
		},
	);

	const rowClassName = `w-full grid grid-cols-[2.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_1.25rem] gap-2 px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${
		activeKey === rowKey
			? "bg-[#8b5cf6]/20 border border-[#8b5cf6]/40 text-[#f1f5f9]"
			: "bg-[#1a1533]/30 border border-transparent hover:bg-[#8b5cf6]/10 hover:border-[rgba(139,92,246,0.15)] text-[#94a3b8] hover:text-[#f1f5f9]"
	}`;

	return (
		<div className="relative overflow-hidden rounded-lg">
			{/* Action layer shown when swiped */}
			{trailing && (
				<div className="absolute inset-y-0 right-0 flex items-center justify-end pr-3 bg-red-500/5">
					<div className="pointer-events-auto">{trailing}</div>
				</div>
			)}
			{/* Swipeable content */}
			<div
				ref={rowRef}
				style={{ touchAction: "pan-y" }}
				className="relative z-10"
			>
				<button type="button" onClick={onClick} className={rowClassName}>
					<span className="font-mono font-medium">{interval.index + 1}</span>
					<span className="font-mono">
						{formatElapsedTime(interval.startSeconds)}
					</span>
					<span className="font-mono">
						{formatElapsedTime(interval.duration)}
					</span>
					<span className="text-right font-semibold text-[#8b5cf6]">
						{interval.avgPower ?? "\u2014"}
					</span>
					<span className="text-right font-semibold text-[#ef4444]">
						{interval.avgHeartRate ?? "\u2014"}
					</span>
					<span className="text-right font-semibold text-[#06b6d4]">
						{interval.avgCadence ?? "\u2014"}
					</span>
					{trailing ? (
						<span aria-hidden="true" />
					) : (
						<ChevronRight
							className={`w-3 h-3 transition-colors ${
								activeKey === rowKey ? "text-[#8b5cf6]" : "text-[#94a3b8]/30"
							}`}
						/>
					)}
				</button>
				{/* Desktop trailing button */}
				{trailing && (
					<div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
						<div className="pointer-events-auto">{trailing}</div>
					</div>
				)}
			</div>
		</div>
	);
}

export function IntervalList({
	records,
	laps,
	onIntervalClick,
	onIntervalsChange,
	onIntervalMinutesChange,
	customIntervals,
	onRemoveCustomInterval,
	initialIntervalMinutes,
}: IntervalListProps) {
	const [intervalMinutes, setIntervalMinutes] = useState<string>(
		() => initialIntervalMinutes || loadIntervalMinutes(),
	);
	const [activeKey, setActiveKey] = useState<string | null>(null);

	const intervalSeconds = useMemo(() => {
		const mins = Number.parseFloat(intervalMinutes);
		if (Number.isNaN(mins) || mins <= 0) return 0;
		return Math.round(mins * 60);
	}, [intervalMinutes]);

	const lapIntervals: Interval[] = useMemo(() => {
		if (intervalSeconds <= 0) return [];
		return computeIntervals(records, laps, intervalSeconds);
	}, [records, laps, intervalSeconds]);

	// Build custom interval objects with stats
	const customIntervalItems: Interval[] = useMemo(() => {
		return customIntervals.map((range, idx) => {
			const [start, end] = range;
			const slice = records.filter(
				(r) => r.elapsedSeconds >= start && r.elapsedSeconds <= end,
			);
			const stats =
				slice.length > 0
					? computeAverages(slice)
					: {
							avgPower: null,
							avgHeartRate: null,
							avgCadence: null,
							duration: 0,
						};
			return {
				index: idx,
				startSeconds: start,
				endSeconds: end,
				avgPower: stats.avgPower,
				avgHeartRate: stats.avgHeartRate,
				avgCadence: stats.avgCadence,
				duration: stats.duration,
			};
		});
	}, [records, customIntervals]);

	useEffect(() => {
		onIntervalsChange(lapIntervals);
	}, [lapIntervals, onIntervalsChange]);

	const handleLapClick = useCallback(
		(interval: Interval) => {
			setActiveKey(`lap-${interval.index}`);
			onIntervalClick(interval.startSeconds, interval.endSeconds);
		},
		[onIntervalClick],
	);

	const handleCustomClick = useCallback(
		(interval: Interval) => {
			setActiveKey(`custom-${interval.index}`);
			onIntervalClick(interval.startSeconds, interval.endSeconds);
		},
		[onIntervalClick],
	);

	const hasLaps = laps.length >= 2;
	const hasContent = hasLaps || customIntervals.length > 0;

	if (!hasContent) return null;

	const tableHeader = (
		<div className="grid grid-cols-[2.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_1.25rem] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#94a3b8] font-medium">
			<span>#</span>
			<span>Start</span>
			<span>Duration</span>
			<span className="text-right">
				<Zap className="w-3 h-3 inline text-[#8b5cf6]" /> W
			</span>
			<span className="text-right">
				<Heart className="w-3 h-3 inline text-[#ef4444]" /> bpm
			</span>
			<span className="text-right">
				<Gauge className="w-3 h-3 inline text-[#06b6d4]" /> rpm
			</span>
			<span />
		</div>
	);

	return (
		<div className="px-6 pb-4">
			<div className="bg-[#1a1533]/40 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl p-4">
				{/* Header with input */}
				<div className="flex items-center gap-4 mb-4">
					<div className="flex items-center gap-2">
						<Timer className="w-4 h-4 text-[#8b5cf6]" />
						<span className="text-sm font-medium text-[#f1f5f9]">
							Intervals
						</span>
						{hasLaps && (
							<span className="text-xs text-[#94a3b8]">
								({laps.length - 1} lap{laps.length - 1 !== 1 ? "s" : ""}{" "}
								detected)
							</span>
						)}
					</div>
					{hasLaps && (
						<div className="flex items-center gap-2">
							<label
								htmlFor="interval-length"
								className="text-xs text-[#94a3b8]"
							>
								Length:
							</label>
							<input
								id="interval-length"
								type="number"
								min="0.1"
								step="0.5"
								placeholder="min"
								value={intervalMinutes}
								onChange={(e) => {
									setIntervalMinutes(e.target.value);
									saveIntervalMinutes(e.target.value);
									onIntervalMinutesChange(e.target.value);
									setActiveKey(null);
								}}
								className="w-20 px-2.5 py-1.5 text-xs font-medium text-[#f1f5f9] bg-[#1a1533]/80 border border-[rgba(139,92,246,0.25)] rounded-lg placeholder-[#94a3b8]/50 focus:outline-none focus:border-[#8b5cf6]/60 focus:ring-1 focus:ring-[#8b5cf6]/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
							/>
							<span className="text-xs text-[#94a3b8]">min</span>
						</div>
					)}
				</div>

				{/* Lap intervals */}
				{lapIntervals.length > 0 && (
					<div className="space-y-1 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
						{tableHeader}
						{lapIntervals.map((interval) => (
							<SwipeableIntervalRow
								key={`lap-${interval.index}`}
								interval={interval}
								activeKey={activeKey}
								rowKey={`lap-${interval.index}`}
								onClick={() => handleLapClick(interval)}
							/>
						))}
					</div>
				)}

				{hasLaps && intervalSeconds > 0 && lapIntervals.length === 0 && (
					<p className="text-xs text-[#94a3b8]/60 text-center py-4">
						No intervals found for this length
					</p>
				)}

				{hasLaps && intervalSeconds === 0 && customIntervals.length === 0 && (
					<p className="text-xs text-[#94a3b8]/60 text-center py-4">
						Set an interval length to split laps into intervals
					</p>
				)}

				{/* Custom intervals */}
				{customIntervalItems.length > 0 && (
					<div className={lapIntervals.length > 0 ? "mt-4" : ""}>
						<p className="text-xs font-medium text-[#f59e0b] uppercase tracking-wider mb-2 px-3">
							Custom intervals
						</p>
						<div className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
							{lapIntervals.length === 0 && tableHeader}
							{customIntervalItems.map((interval) => (
								<SwipeableIntervalRow
									key={`custom-${interval.index}`}
									interval={interval}
									activeKey={activeKey}
									rowKey={`custom-${interval.index}`}
									onClick={() => handleCustomClick(interval)}
									trailing={
										<button
											type="button"
											aria-label={`Remove custom interval ${interval.index + 1}`}
											onClick={(e: React.MouseEvent) => {
												e.stopPropagation();
												onRemoveCustomInterval(interval.index);
											}}
											className="w-3 h-3 text-[#94a3b8]/40 hover:text-[#ef4444] transition-colors cursor-pointer"
										>
											<X className="w-3 h-3" />
										</button>
									}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
