import type { ActivityRecord, Interval } from "@fit-analyzer/shared";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Gauge,
	Heart,
	Plus,
	Search,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatElapsedTime } from "../lib/formatters";
import { detectPowerIntervals } from "../lib/stats";

const DEBOUNCE_MS = 500;

const DEFAULT_MIN_POWER = 200;
const DEFAULT_MIN_SECONDS = 10;
const DEFAULT_COASTING = 2;

interface AutoDetectIntervalsProps {
	records: ActivityRecord[];
	onAddInterval: (startSeconds: number, endSeconds: number) => void;
	customIntervals: [number, number][];
}

export function AutoDetectIntervals({
	records,
	onAddInterval,
	customIntervals,
}: AutoDetectIntervalsProps) {
	const hasPower =
		records.length > 0 && records.some((r) => r.power !== null && r.power > 0);

	const [rawMinPower, setRawMinPower] = useState(String(DEFAULT_MIN_POWER));
	const [rawMinSeconds, setRawMinSeconds] = useState(
		String(DEFAULT_MIN_SECONDS),
	);
	const [rawCoasting, setRawCoasting] = useState(String(DEFAULT_COASTING));
	const [debouncedPower, setDebouncedPower] = useState(DEFAULT_MIN_POWER);
	const [debouncedSeconds, setDebouncedSeconds] = useState(DEFAULT_MIN_SECONDS);
	const [debouncedCoasting, setDebouncedCoasting] = useState(DEFAULT_COASTING);
	const [collapsed, setCollapsed] = useState(true);

	const powerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const secondsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const coastingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
		powerTimerRef.current = setTimeout(() => {
			const v = Number.parseInt(rawMinPower, 10);
			if (!Number.isNaN(v)) setDebouncedPower(v);
		}, DEBOUNCE_MS);
		return () => {
			if (powerTimerRef.current) clearTimeout(powerTimerRef.current);
		};
	}, [rawMinPower]);

	useEffect(() => {
		if (secondsTimerRef.current) clearTimeout(secondsTimerRef.current);
		secondsTimerRef.current = setTimeout(() => {
			const v = Number.parseInt(rawMinSeconds, 10);
			if (!Number.isNaN(v)) setDebouncedSeconds(v);
		}, DEBOUNCE_MS);
		return () => {
			if (secondsTimerRef.current) clearTimeout(secondsTimerRef.current);
		};
	}, [rawMinSeconds]);

	useEffect(() => {
		if (coastingTimerRef.current) clearTimeout(coastingTimerRef.current);
		coastingTimerRef.current = setTimeout(() => {
			const v = Number.parseFloat(rawCoasting);
			if (!Number.isNaN(v) && v >= 0) setDebouncedCoasting(v);
		}, DEBOUNCE_MS);
		return () => {
			if (coastingTimerRef.current) clearTimeout(coastingTimerRef.current);
		};
	}, [rawCoasting]);

	const detectedIntervals: Interval[] = useMemo(() => {
		if (!hasPower) return [];
		return detectPowerIntervals(
			records,
			debouncedPower,
			debouncedSeconds,
			debouncedCoasting,
		);
	}, [records, hasPower, debouncedPower, debouncedSeconds, debouncedCoasting]);

	const isAlreadyAdded = useCallback(
		(startSeconds: number, endSeconds: number) => {
			return customIntervals.some(
				([s, e]) => s === startSeconds && e === endSeconds,
			);
		},
		[customIntervals],
	);

	const anyAvailable = detectedIntervals.some(
		(i) => !isAlreadyAdded(i.startSeconds, i.endSeconds),
	);

	const handleAddAll = useCallback(() => {
		for (const interval of detectedIntervals) {
			if (!isAlreadyAdded(interval.startSeconds, interval.endSeconds)) {
				onAddInterval(interval.startSeconds, interval.endSeconds);
			}
		}
	}, [detectedIntervals, isAlreadyAdded, onAddInterval]);

	if (!hasPower) return null;

	const tableHeader = (
		<div className="grid grid-cols-[2.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_4.5rem_2.5rem] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#94a3b8] font-medium">
			<span>#</span>
			<span>Start</span>
			<span>Duration</span>
			<span className="text-right">
				<Zap className="w-3 h-3 inline text-[#8b5cf6]" /> Avg W
			</span>
			<span className="text-right">
				<Zap className="w-3 h-3 inline text-[#a855f7]" /> NP W
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

	const inputClass =
		"w-24 px-2.5 py-1.5 text-xs font-medium text-[#f1f5f9] bg-[#1a1533]/80 border border-[rgba(139,92,246,0.25)] rounded-lg placeholder-[#94a3b8]/50 focus:outline-none focus:border-[#8b5cf6]/60 focus:ring-1 focus:ring-[#8b5cf6]/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

	return (
		<div className="px-6 pb-4">
			<div className="bg-[#1a1533]/40 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl p-4">
				{/* Header with toggle and inputs */}
				<button
					type="button"
					onClick={() => setCollapsed((c) => !c)}
					className="flex items-center gap-2 w-full text-left mb-3 cursor-pointer"
				>
					{collapsed ? (
						<ChevronRight className="w-4 h-4 text-[#8b5cf6]" />
					) : (
						<ChevronDown className="w-4 h-4 text-[#8b5cf6]" />
					)}
					<Search className="w-4 h-4 text-[#8b5cf6]" />
					<span className="text-sm font-medium text-[#f1f5f9]">
						Auto-detect intervals
					</span>
				</button>

				{collapsed ? null : (
					<>
						{/* Input row */}
						<div className="flex items-center gap-3 mb-3 flex-wrap">
							<div className="flex items-center gap-1.5">
								<label
									htmlFor="auto-detect-min-power"
									className="text-xs text-[#94a3b8]"
								>
									Min power:
								</label>
								<input
									id="auto-detect-min-power"
									type="number"
									min="0"
									step="5"
									value={rawMinPower}
									onChange={(e) => setRawMinPower(e.target.value)}
									className={inputClass}
								/>
								<span className="text-xs text-[#94a3b8]">W</span>
							</div>
							<div className="flex items-center gap-1.5">
								<label
									htmlFor="auto-detect-min-seconds"
									className="text-xs text-[#94a3b8]"
								>
									Min duration:
								</label>
								<input
									id="auto-detect-min-seconds"
									type="number"
									min="0"
									step="1"
									value={rawMinSeconds}
									onChange={(e) => setRawMinSeconds(e.target.value)}
									className={inputClass}
								/>
								<span className="text-xs text-[#94a3b8]">s</span>
							</div>
							<div className="flex items-center gap-1.5">
								<label
									htmlFor="auto-detect-coasting"
									className="text-xs text-[#94a3b8]"
								>
									Coasting:
								</label>
								<input
									id="auto-detect-coasting"
									type="number"
									min="0"
									step="0.5"
									value={rawCoasting}
									onChange={(e) => setRawCoasting(e.target.value)}
									className={inputClass}
								/>
								<span className="text-xs text-[#94a3b8]">s</span>
							</div>
							{detectedIntervals.length > 0 && anyAvailable && (
								<button
									type="button"
									onClick={handleAddAll}
									className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#f1f5f9] bg-[#8b5cf6]/20 hover:bg-[#8b5cf6]/30 border border-[#8b5cf6]/30 rounded-lg transition-colors cursor-pointer"
								>
									<Plus className="w-3 h-3" />
									Add all (
									{
										detectedIntervals.filter(
											(i) => !isAlreadyAdded(i.startSeconds, i.endSeconds),
										).length
									}
									)
								</button>
							)}
						</div>

						{/* Results table */}
						{detectedIntervals.length > 0 && (
							<div className="space-y-1 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
								{tableHeader}
								{detectedIntervals.map((interval) => {
									const added = isAlreadyAdded(
										interval.startSeconds,
										interval.endSeconds,
									);
									return (
										<button
											type="button"
											key={`detected-${interval.index}`}
											disabled={added}
											onClick={() =>
												onAddInterval(
													interval.startSeconds,
													interval.endSeconds,
												)
											}
											className={`w-full grid grid-cols-[2.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_4.5rem_2.5rem] gap-2 px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${
												added
													? "bg-[#1a1533]/20 border border-transparent text-[#94a3b8]/40 cursor-default"
													: "bg-[#1a1533]/30 border border-transparent hover:bg-[#8b5cf6]/10 hover:border-[rgba(139,92,246,0.15)] text-[#94a3b8] hover:text-[#f1f5f9]"
											}`}
										>
											<span className="font-mono font-medium">
												{interval.index + 1}
											</span>
											<span className="font-mono">
												{formatElapsedTime(interval.startSeconds)}
											</span>
											<span className="font-mono">
												{formatElapsedTime(interval.duration)}
											</span>
											<span className="text-right font-semibold text-[#8b5cf6]">
												{interval.avgPower ?? "\u2014"}
											</span>
											<span className="text-right font-semibold text-[#a855f7]">
												{interval.normalizedPower ?? "\u2014"}
											</span>
											<span className="text-right font-semibold text-[#ef4444]">
												{interval.avgHeartRate ?? "\u2014"}
											</span>
											<span className="text-right font-semibold text-[#06b6d4]">
												{interval.avgCadence ?? "\u2014"}
											</span>
											<span className="flex items-center justify-center">
												{added ? (
													<Check className="w-3.5 h-3.5 text-[#10b981]/40" />
												) : (
													<Plus className="w-3.5 h-3.5 text-[#8b5cf6]" />
												)}
											</span>
										</button>
									);
								})}
							</div>
						)}

						{detectedIntervals.length === 0 && (
							<p className="text-xs text-[#94a3b8]/60 text-center py-4">
								No intervals detected. Adjust min power or min duration.
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}
