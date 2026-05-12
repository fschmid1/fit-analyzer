import { memo, useCallback, useMemo, useState, useRef, useEffect } from "react";
import { usePinch, useDrag } from "@use-gesture/react";
import {
	ComposedChart,
	Area,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	ReferenceArea,
	ResponsiveContainer,
	CartesianGrid,
} from "recharts";
import {
	Zap,
	Heart,
	Gauge,
	Wind,
	TrendingUp,
	X,
	ZoomIn,
	ZoomOut,
	Plus,
} from "lucide-react";
import { formatElapsedTime } from "../lib/formatters";
import type { ActivityRecord } from "@fit-analyzer/shared";
import { CustomTooltip } from "./CustomTooltip";
import {
	findNearestElapsedIndex,
	findStartIndex,
	findEndIndex,
	type ChartDataPoint,
} from "./chartHelpers";
import {
	CHART_MARGIN,
	AXIS_TICK,
	AXIS_LINE,
	TICK_LINE,
	POWER_ACTIVE_DOT,
	HR_ACTIVE_DOT,
	CAD_ACTIVE_DOT,
	SPEED_ACTIVE_DOT,
	GRADIENT_ACTIVE_DOT,
	DEFAULT_INITIAL_WINDOW_SECONDS,
} from "./chartConfig";

interface ActivityChartProps {
	records: ActivityRecord[];
	onSelectionChange: (range: [number, number] | null) => void;
	/** When set, chart zooms to this range. Change the reference to re-trigger. */
	externalZoom?: [number, number] | null;
	/** All interval ranges to highlight on the chart */
	intervalRanges?: [number, number][];
	/** Called when user adds the current selection as a custom interval */
	onAddInterval?: (startSeconds: number, endSeconds: number) => void;
}

interface ChartPointerEvent {
	activeLabel?: number | string;
}

export const ActivityChart = memo(function ActivityChart({
	records,
	onSelectionChange,
	externalZoom,
	intervalRanges,
	onAddInterval,
}: ActivityChartProps) {
	const {
		data,
		hasPower,
		hasHeartRate,
		hasCadence,
		hasSpeed,
		hasGradient,
		fullRange,
	} = useMemo(() => {
		let hasPower = false;
		let hasHeartRate = false;
		let hasCadence = false;
		let hasSpeed = false;
		let hasGradient = false;

		const data = records.map((r) => {
			if (r.power !== null) hasPower = true;
			if (r.heartRate !== null) hasHeartRate = true;
			if (r.cadence !== null) hasCadence = true;
			if ((r.speed ?? null) !== null) hasSpeed = true;
			if ((r.gradient ?? null) !== null) hasGradient = true;

			return {
				elapsedSeconds: r.elapsedSeconds,
				power: r.power,
				heartRate: r.heartRate,
				cadence: r.cadence,
				speed: r.speed ?? null,
				gradient: r.gradient ?? null,
			};
		});

		const firstPoint = data[0];
		const lastPoint = data[data.length - 1];
		const fullRange: [number, number] | null =
			firstPoint && lastPoint
				? [firstPoint.elapsedSeconds, lastPoint.elapsedSeconds]
				: null;

		return {
			data,
			hasPower,
			hasHeartRate,
			hasCadence,
			hasSpeed,
			hasGradient,
			fullRange,
		};
	}, [records]);

	// --- Series visibility toggles ---
	const [showPower, setShowPower] = useState(true);
	const [showHeartRate, setShowHeartRate] = useState(true);
	const [showCadence, setShowCadence] = useState(true);
	const [showSpeed, setShowSpeed] = useState(true);
	const [showGradient, setShowGradient] = useState(true);

	// --- Zoom state (stack of [startSeconds, endSeconds] ranges) ---
	const [zoomStack, setZoomStack] = useState<[number, number][]>([]);

	// Current zoom window — filter data to this range
	const currentZoom =
		zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : null;

	const visibleData: ChartDataPoint[] = useMemo(() => {
		if (!currentZoom) return data;
		const startIndex = findStartIndex(data, currentZoom[0]);
		const endIndex = findEndIndex(data, currentZoom[1]);
		return data.slice(startIndex, endIndex);
	}, [data, currentZoom]);

	// --- Rubber-band (marquee) selection state ---
	const [dragStart, setDragStart] = useState<number | null>(null);
	const [dragEnd, setDragEnd] = useState<number | null>(null);
	const [selection, setSelection] = useState<[number, number] | null>(null);
	const isDragging = useRef(false);

	// Map an elapsedSeconds value to the nearest data index (in the full records array)
	const secondsToIndex = useCallback(
		(seconds: number): number => findNearestElapsedIndex(records, seconds),
		[records],
	);

	const handleMouseDown = useCallback((e: ChartPointerEvent) => {
		if (e && typeof e.activeLabel === "number") {
			isDragging.current = true;
			setDragStart(e.activeLabel);
			setDragEnd(e.activeLabel);
			setSelection(null);
			selectionChangeRef.current(null);
		}
	}, []);

	const handleMouseMove = useCallback((e: ChartPointerEvent) => {
		if (isDragging.current && e && typeof e.activeLabel === "number") {
			setDragEnd(e.activeLabel);
		}
	}, []);

	const handleMouseUp = useCallback(() => {
		if (isDragging.current && dragStart !== null && dragEnd !== null) {
			isDragging.current = false;
			const left = Math.min(dragStart, dragEnd);
			const right = Math.max(dragStart, dragEnd);
			const startIdx = secondsToIndex(left);
			const endIdx = secondsToIndex(right);
			if (startIdx !== endIdx) {
				setSelection([left, right]);
				onSelectionChange([startIdx, endIdx]);
			} else {
				// Click without meaningful drag — clear selection
				setSelection(null);
				onSelectionChange(null);
			}
			setDragStart(null);
			setDragEnd(null);
		}
	}, [dragStart, dragEnd, secondsToIndex, onSelectionChange]);

	const clearSelection = useCallback(() => {
		setSelection(null);
		setDragStart(null);
		setDragEnd(null);
		onSelectionChange(null);
	}, [onSelectionChange]);

	const handleZoomIn = useCallback(() => {
		if (!selection) return;
		setZoomStack((prev) => [...prev, selection]);
		setSelection(null);
		onSelectionChange(null);
	}, [selection, onSelectionChange]);

	const handleZoomOut = useCallback(() => {
		setZoomStack((prev) => prev.slice(0, -1));
		setSelection(null);
		onSelectionChange(null);
	}, [onSelectionChange]);

	const handleResetZoom = useCallback(() => {
		setZoomStack([]);
		setSelection(null);
		onSelectionChange(null);
	}, [onSelectionChange]);

	const handleAddInterval = useCallback(() => {
		if (!selection || !onAddInterval) return;
		onAddInterval(selection[0], selection[1]);
		setSelection(null);
		onSelectionChange(null);
	}, [selection, onAddInterval, onSelectionChange]);

	// --- External zoom (e.g. from interval list click) ---
	useEffect(() => {
		if (externalZoom) {
			setZoomStack([externalZoom]);
			setSelection(null);
			selectionChangeRef.current(null);
		}
	}, [externalZoom]);

	useEffect(() => {
		if (!fullRange || externalZoom) return;

		const [fullMin, fullMax] = fullRange;
		if (fullMax - fullMin <= DEFAULT_INITIAL_WINDOW_SECONDS) {
			setZoomStack([]);
			return;
		}

		setZoomStack([
			[fullMin, fullMin + DEFAULT_INITIAL_WINDOW_SECONDS] as [number, number],
		]);
	}, [fullRange, externalZoom]);

	// --- Detect touch device for UI hints ---
	const [isTouchDevice, setIsTouchDevice] = useState(false);
	useEffect(() => {
		setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
	}, []);

	// --- Ctrl + Mouse Wheel zoom / scroll to pan ---
	const chartContainerRef = useRef<HTMLDivElement>(null);
	const zoomStackRef = useRef<[number, number][]>([]);
	const wheelFrameRef = useRef<number | null>(null);
	const pendingZoomRef = useRef<[number, number][] | null>(null);
	const selectionChangeRef = useRef(onSelectionChange);

	// Keep ref in sync with state for synchronous access in wheel handler
	useEffect(() => {
		zoomStackRef.current = zoomStack;
	}, [zoomStack]);

	useEffect(() => {
		selectionChangeRef.current = onSelectionChange;
	}, [onSelectionChange]);

	useEffect(() => {
		const container = chartContainerRef.current;
		if (!container || !fullRange) return;

		const flushPendingZoom = () => {
			wheelFrameRef.current = null;
			if (pendingZoomRef.current) {
				setZoomStack(pendingZoomRef.current);
				pendingZoomRef.current = null;
			}
		};

		const handleWheel = (e: WheelEvent) => {
			const [fullMin, fullMax] = fullRange;
			const currentStack = pendingZoomRef.current ?? zoomStackRef.current;

			if (e.ctrlKey) {
				// Ctrl + scroll = zoom in/out
				e.preventDefault();

				const rect = container.getBoundingClientRect();
				const plotLeft = 55;
				const plotRight = rect.width - 55;
				const plotWidth = plotRight - plotLeft;
				const mouseX = e.clientX - rect.left;
				const ratio = Math.max(0, Math.min(1, (mouseX - plotLeft) / plotWidth));

				const current =
					currentStack.length > 0
						? currentStack[currentStack.length - 1]
						: ([fullMin, fullMax] as [number, number]);
				if (!current) return;
				const span = current[1] - current[0];
				const center = current[0] + span * ratio;

				const zoomFactor = e.deltaY < 0 ? 0.7 : 1.4;
				let newSpan = span * zoomFactor;

				if (newSpan >= fullMax - fullMin) {
					pendingZoomRef.current = [];
				} else {
					if (newSpan < 5) newSpan = 5;

					let newStart = center - newSpan * ratio;
					let newEnd = center + newSpan * (1 - ratio);

					if (newStart < fullMin) {
						newStart = fullMin;
						newEnd = newStart + newSpan;
					}
					if (newEnd > fullMax) {
						newEnd = fullMax;
						newStart = newEnd - newSpan;
					}
					newStart = Math.max(fullMin, newStart);
					newEnd = Math.min(fullMax, newEnd);

					const newZoom: [number, number] = [newStart, newEnd];
					pendingZoomRef.current =
						currentStack.length === 0
							? [newZoom]
							: [...currentStack.slice(0, -1), newZoom];
				}

				setSelection(null);
				selectionChangeRef.current(null);
			} else {
				if (currentStack.length === 0) return;
				e.preventDefault();

				const current = currentStack[currentStack.length - 1];
				if (!current) return;
				const span = current[1] - current[0];
				const delta =
					Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
				const panAmount = span * 0.05 * Math.sign(delta);

				let newStart = current[0] + panAmount;
				let newEnd = current[1] + panAmount;

				if (newStart < fullMin) {
					newStart = fullMin;
					newEnd = fullMin + span;
				}
				if (newEnd > fullMax) {
					newEnd = fullMax;
					newStart = fullMax - span;
				}

				const newZoom: [number, number] = [newStart, newEnd];
				pendingZoomRef.current = [...currentStack.slice(0, -1), newZoom];
			}

			if (wheelFrameRef.current === null) {
				wheelFrameRef.current = requestAnimationFrame(flushPendingZoom);
			}
		};

		container.addEventListener("wheel", handleWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", handleWheel);
			if (wheelFrameRef.current !== null) {
				cancelAnimationFrame(wheelFrameRef.current);
				wheelFrameRef.current = null;
			}
			pendingZoomRef.current = null;
		};
	}, [fullRange]);

	// --- Touch pinch-to-zoom and drag-to-pan ---
	usePinch(
		({ origin: [ox], offset: [scale], active, memo }) => {
			if (!chartContainerRef.current || !fullRange) return;
			const [fullMin, fullMax] = fullRange;
			const current =
				zoomStack.length > 0
					? zoomStack[zoomStack.length - 1]
					: ([fullMin, fullMax] as [number, number]);
			if (!current) return;
			const span = current[1] - current[0];

			if (!active) {
				const rect = chartContainerRef.current.getBoundingClientRect();
				const plotLeft = 55;
				const plotRight = rect.width - 55;
				const plotWidth = plotRight - plotLeft;
				const ratio = Math.max(0, Math.min(1, (ox - plotLeft) / plotWidth));

				const newSpan = Math.max(5, Math.min(fullMax - fullMin, span / scale));
				let newStart = current[0] + span * ratio - newSpan * ratio;
				let newEnd = newStart + newSpan;

				if (newStart < fullMin) {
					newStart = fullMin;
					newEnd = newStart + newSpan;
				}
				if (newEnd > fullMax) {
					newEnd = fullMax;
					newStart = newEnd - newSpan;
				}
				newStart = Math.max(fullMin, newStart);
				newEnd = Math.min(fullMax, newEnd);

				if (newSpan >= fullMax - fullMin - 1) {
					setZoomStack([]);
				} else {
					setZoomStack((prev) =>
						prev.length === 0
							? [[newStart, newEnd]]
							: [...prev.slice(0, -1), [newStart, newEnd]],
					);
				}
				setSelection(null);
				selectionChangeRef.current(null);
				return;
			}

			return memo;
		},
		{
			target: chartContainerRef,
			scaleBounds: { min: 0.2, max: 50 },
			from: () => {
				if (!fullRange) return [0, 1];
				const current =
					zoomStack.length > 0 ? zoomStack[zoomStack.length - 1] : fullRange;
				const span = current[1] - current[0];
				return [0, (fullRange[1] - fullRange[0]) / span];
			},
		},
	);

	// Touch drag-to-pan
	useDrag(
		({ active, movement: [mx], memo }) => {
			if (!chartContainerRef.current || !fullRange) return;
			const [fullMin, fullMax] = fullRange;
			if (!memo) memo = zoomStack;
			const current = memo.length > 0 ? memo[memo.length - 1] : null;
			if (!current) return memo;
			const span = current[1] - current[0];
			const rect = chartContainerRef.current.getBoundingClientRect();
			const plotLeft = 55;
			const plotRight = rect.width - 55;
			const plotWidth = plotRight - plotLeft;
			const pxToSeconds = span / plotWidth;
			const deltaSeconds = -mx * pxToSeconds;

			let newStart = current[0] + deltaSeconds;
			let newEnd = current[1] + deltaSeconds;

			if (newStart < fullMin) {
				newStart = fullMin;
				newEnd = fullMin + span;
			}
			if (newEnd > fullMax) {
				newEnd = fullMax;
				newStart = fullMax - span;
			}

			if (active) {
				const nextZoom: [number, number] = [newStart, newEnd];
				setZoomStack([...memo.slice(0, -1), nextZoom]);
				return memo;
			}
			return memo;
		},
		{
			target: chartContainerRef,
			axis: "x",
			pointer: { touch: true },
			bounds: {
				left: Number.NEGATIVE_INFINITY,
				right: Number.POSITIVE_INFINITY,
			},
			preventScrollAxis: "x",
		},
	);

	const overlayAxisId = useMemo(() => {
		if (hasPower && showPower) return "power";
		if (
			(hasHeartRate && showHeartRate) ||
			(hasCadence && showCadence) ||
			(hasSpeed && showSpeed)
		) {
			return "hrCad";
		}
		if (hasGradient && showGradient) return "gradient";
		return null;
	}, [
		hasPower,
		showPower,
		hasHeartRate,
		showHeartRate,
		hasCadence,
		showCadence,
		hasSpeed,
		showSpeed,
		hasGradient,
		showGradient,
	]);

	// Compute Y-axis domains based on VISIBLE data
	const powerDomain = useMemo(() => {
		if (!hasPower || !showPower) return [0, 400];
		const powers = visibleData
			.filter((r) => r.power !== null)
			.map((r) => r.power)
			.filter((value): value is number => value !== null);
		if (powers.length === 0) return [0, 400];
		return [0, Math.ceil((Math.max(...powers) * 1.1) / 50) * 50];
	}, [visibleData, hasPower, showPower]);

	const hrCadDomain = useMemo(() => {
		const values: number[] = [];
		if (hasHeartRate && showHeartRate)
			values.push(
				...visibleData
					.filter((r) => r.heartRate !== null)
					.map((r) => r.heartRate)
					.filter((value): value is number => value !== null),
			);
		if (hasCadence && showCadence)
			values.push(
				...visibleData
					.filter((r) => r.cadence !== null)
					.map((r) => r.cadence)
					.filter((value): value is number => value !== null),
			);
		if (hasSpeed && showSpeed)
			values.push(
				...visibleData
					.filter((r) => r.speed !== null)
					.map((r) => r.speed)
					.filter((value): value is number => value !== null),
			);
		if (values.length === 0) return [0, 200];
		return [
			Math.floor((Math.min(...values) * 0.9) / 10) * 10,
			Math.ceil((Math.max(...values) * 1.1) / 10) * 10,
		];
	}, [
		visibleData,
		hasHeartRate,
		hasCadence,
		hasSpeed,
		showHeartRate,
		showCadence,
		showSpeed,
	]);

	const gradientDomain = useMemo(() => {
		if (!hasGradient || !showGradient) return [-20, 20];
		const vals = visibleData
			.filter((r) => r.gradient !== null)
			.map((r) => r.gradient)
			.filter((value): value is number => value !== null);
		if (vals.length === 0) return [-20, 20];
		const min = Math.floor((Math.min(...vals, 0) * 1.2) / 5) * 5;
		const max = Math.ceil((Math.max(...vals, 0) * 1.2) / 5) * 5;
		return [Math.min(min, -5), Math.max(max, 5)];
	}, [visibleData, hasGradient, showGradient]);

	// Determine which ReferenceArea to show: active drag or committed selection
	const refAreaLeft =
		dragStart !== null && dragEnd !== null
			? Math.min(dragStart, dragEnd)
			: selection
				? selection[0]
				: null;
	const refAreaRight =
		dragStart !== null && dragEnd !== null
			? Math.max(dragStart, dragEnd)
			: selection
				? selection[1]
				: null;

	return (
		<div className="px-6 pb-4">
			<div className="bg-[#1a1533]/40 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl p-4 pt-6">
				{/* Legend + selection hint */}
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-6 ml-12">
						{hasPower && (
							<button
								type="button"
								onClick={() => setShowPower((v) => !v)}
								className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${showPower ? "opacity-100" : "opacity-40"}`}
							>
								<Zap className="w-3.5 h-3.5 text-[#8b5cf6]" />
								<span
									className={`text-xs font-medium text-[#94a3b8] ${!showPower ? "line-through" : ""}`}
								>
									Power (W)
								</span>
							</button>
						)}
						{hasHeartRate && (
							<button
								type="button"
								onClick={() => setShowHeartRate((v) => !v)}
								className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${showHeartRate ? "opacity-100" : "opacity-40"}`}
							>
								<Heart className="w-3.5 h-3.5 text-[#ef4444]" />
								<span
									className={`text-xs font-medium text-[#94a3b8] ${!showHeartRate ? "line-through" : ""}`}
								>
									Heart Rate (bpm)
								</span>
							</button>
						)}
						{hasCadence && (
							<button
								type="button"
								onClick={() => setShowCadence((v) => !v)}
								className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${showCadence ? "opacity-100" : "opacity-40"}`}
							>
								<Gauge className="w-3.5 h-3.5 text-[#06b6d4]" />
								<span
									className={`text-xs font-medium text-[#94a3b8] ${!showCadence ? "line-through" : ""}`}
								>
									Cadence (rpm)
								</span>
							</button>
						)}
						{hasSpeed && (
							<button
								type="button"
								onClick={() => setShowSpeed((v) => !v)}
								className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${showSpeed ? "opacity-100" : "opacity-40"}`}
							>
								<Wind className="w-3.5 h-3.5 text-[#f59e0b]" />
								<span
									className={`text-xs font-medium text-[#94a3b8] ${!showSpeed ? "line-through" : ""}`}
								>
									Speed (km/h)
								</span>
							</button>
						)}
						{hasGradient && (
							<button
								type="button"
								onClick={() => setShowGradient((v) => !v)}
								className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${showGradient ? "opacity-100" : "opacity-40"}`}
							>
								<TrendingUp className="w-3.5 h-3.5 text-[#10b981]" />
								<span
									className={`text-xs font-medium text-[#94a3b8] ${!showGradient ? "line-through" : ""}`}
								>
									Steigung (%)
								</span>
							</button>
						)}
					</div>

					<div className="flex items-center gap-2">
						{/* Zoom controls */}
						{zoomStack.length > 0 && (
							<>
								<button
									type="button"
									onClick={handleZoomOut}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/60 hover:bg-[#8b5cf6]/20 border border-[rgba(139,92,246,0.2)] rounded-lg transition-colors cursor-pointer"
								>
									<ZoomOut className="w-3 h-3" />
									Zoom out
								</button>
								{zoomStack.length > 1 && (
									<button
										type="button"
										onClick={handleResetZoom}
										className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/60 hover:bg-[#8b5cf6]/20 border border-[rgba(139,92,246,0.2)] rounded-lg transition-colors cursor-pointer"
									>
										Reset zoom
									</button>
								)}
							</>
						)}

						{/* Selection controls */}
						{selection ? (
							<>
								<button
									type="button"
									onClick={handleZoomIn}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#f1f5f9] bg-[#8b5cf6]/30 hover:bg-[#8b5cf6]/40 border border-[#8b5cf6]/40 rounded-lg transition-colors cursor-pointer"
								>
									<ZoomIn className="w-3 h-3" />
									Zoom to selection
								</button>
								{onAddInterval && (
									<button
										type="button"
										onClick={handleAddInterval}
										className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#f59e0b] bg-[#f59e0b]/10 hover:bg-[#f59e0b]/20 border border-[#f59e0b]/30 rounded-lg transition-colors cursor-pointer"
									>
										<Plus className="w-3 h-3" />
										Add interval
									</button>
								)}
								<button
									type="button"
									onClick={clearSelection}
									className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/60 hover:bg-[#8b5cf6]/20 border border-[rgba(139,92,246,0.2)] rounded-lg transition-colors cursor-pointer"
								>
									<X className="w-3 h-3" />
								</button>
							</>
						) : (
							<span className="text-xs text-[#94a3b8]/60 mr-2 select-none">
								{isTouchDevice
									? "Pinch to zoom · Drag to pan"
									: "Drag to select · Scroll to pan · Ctrl+scroll to zoom"}
							</span>
						)}
					</div>
				</div>

				<div
					ref={chartContainerRef}
					style={{ userSelect: "none" }}
					className="cursor-crosshair"
				>
					<ResponsiveContainer width="100%" height={420}>
						<ComposedChart
							data={visibleData}
							margin={CHART_MARGIN}
							onMouseDown={handleMouseDown}
							onMouseMove={handleMouseMove}
							onMouseUp={handleMouseUp}
							onMouseLeave={handleMouseUp}
							onDoubleClick={
								selection
									? handleZoomIn
									: zoomStack.length > 0
										? handleZoomOut
										: undefined
							}
						>
							<defs>
								<linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
									<stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
								</linearGradient>
								<linearGradient
									id="gradientGradient"
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
									<stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
								</linearGradient>
							</defs>

							<CartesianGrid
								strokeDasharray="3 3"
								stroke="rgba(139, 92, 246, 0.06)"
								vertical={false}
							/>

							<XAxis
								dataKey="elapsedSeconds"
								tickFormatter={formatElapsedTime}
								stroke="#94a3b8"
								tick={AXIS_TICK}
								axisLine={AXIS_LINE}
								tickLine={TICK_LINE}
								interval="preserveStartEnd"
								minTickGap={60}
							/>

							{hasPower && showPower && (
								<YAxis
									yAxisId="power"
									orientation="left"
									domain={powerDomain}
									stroke="#94a3b8"
									tick={AXIS_TICK}
									axisLine={AXIS_LINE}
									tickLine={false}
									width={45}
								/>
							)}

							{((hasHeartRate && showHeartRate) ||
								(hasCadence && showCadence) ||
								(hasSpeed && showSpeed)) && (
								<YAxis
									yAxisId="hrCad"
									orientation="right"
									domain={hrCadDomain}
									stroke="#94a3b8"
									tick={AXIS_TICK}
									axisLine={AXIS_LINE}
									tickLine={false}
									width={55}
								/>
							)}

							{hasGradient && showGradient && (
								<YAxis
									yAxisId="gradient"
									orientation="right"
									domain={gradientDomain}
									stroke="#10b981"
									tick={{ ...AXIS_TICK, fill: "#10b981" }}
									axisLine={{ stroke: "rgba(16, 185, 129, 0.2)" }}
									tickLine={false}
									width={40}
									tickFormatter={(v) => `${v}%`}
								/>
							)}

							<Tooltip content={<CustomTooltip />} />

							{hasPower && showPower && (
								<Area
									yAxisId="power"
									type="monotone"
									dataKey="power"
									stroke="#8b5cf6"
									strokeWidth={1.5}
									fill="url(#powerGradient)"
									dot={false}
									activeDot={POWER_ACTIVE_DOT}
									connectNulls
									isAnimationActive={false}
								/>
							)}

							{hasHeartRate && showHeartRate && (
								<Line
									yAxisId="hrCad"
									type="monotone"
									dataKey="heartRate"
									stroke="#ef4444"
									strokeWidth={1.5}
									dot={false}
									activeDot={HR_ACTIVE_DOT}
									connectNulls
									isAnimationActive={false}
								/>
							)}

							{hasCadence && showCadence && (
								<Line
									yAxisId={
										(hasHeartRate && showHeartRate) ||
										(hasCadence && showCadence)
											? "hrCad"
											: "power"
									}
									type="monotone"
									dataKey="cadence"
									stroke="#06b6d4"
									strokeWidth={1.5}
									dot={false}
									activeDot={CAD_ACTIVE_DOT}
									connectNulls
									isAnimationActive={false}
								/>
							)}

							{hasSpeed && showSpeed && (
								<Line
									yAxisId="hrCad"
									type="monotone"
									dataKey="speed"
									stroke="#f59e0b"
									strokeWidth={1.5}
									dot={false}
									activeDot={SPEED_ACTIVE_DOT}
									connectNulls
									isAnimationActive={false}
								/>
							)}

							{hasGradient && showGradient && (
								<Area
									yAxisId="gradient"
									type="monotone"
									dataKey="gradient"
									stroke="#10b981"
									strokeWidth={1.5}
									fill="url(#gradientGradient)"
									dot={false}
									activeDot={GRADIENT_ACTIVE_DOT}
									connectNulls
									isAnimationActive={false}
								/>
							)}

							{/* Interval highlight overlays */}
							{intervalRanges?.map((range) => (
								<ReferenceArea
									key={`${range[0]}-${range[1]}`}
									yAxisId={overlayAxisId ?? undefined}
									x1={range[0]}
									x2={range[1]}
									fill="#f59e0b"
									fillOpacity={0.1}
									stroke="#f59e0b"
									strokeOpacity={0.4}
									strokeDasharray="6 3"
								/>
							))}

							{/* Rubber-band selection overlay */}
							{refAreaLeft !== null && refAreaRight !== null && (
								<ReferenceArea
									yAxisId={overlayAxisId ?? undefined}
									x1={refAreaLeft}
									x2={refAreaRight}
									fill="#8b5cf6"
									fillOpacity={0.15}
									stroke="#8b5cf6"
									strokeOpacity={0.4}
									strokeDasharray="4 2"
								/>
							)}
						</ComposedChart>
					</ResponsiveContainer>
				</div>
			</div>
		</div>
	);
});
