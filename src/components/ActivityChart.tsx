import { useCallback, useMemo, useState, useRef } from "react";
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
import { Zap, Heart, Gauge, X } from "lucide-react";
import { formatElapsedTime } from "../lib/formatters";
import type { ActivityRecord } from "../types/fit";

interface ActivityChartProps {
  records: ActivityRecord[];
  onSelectionChange: (range: [number, number] | null) => void;
}

interface ChartDataPoint {
  elapsedSeconds: number;
  power: number | null;
  heartRate: number | null;
  cadence: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-[#1a1533]/95 backdrop-blur-xl border border-[rgba(139,92,246,0.2)] rounded-xl p-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <p className="text-xs text-[#94a3b8] mb-2 font-medium">
        {formatElapsedTime(label)}
      </p>
      {payload.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entry: any) =>
          entry.value !== null && (
            <div
              key={entry.dataKey}
              className="flex items-center gap-2 text-sm"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-[#94a3b8] capitalize">
                {entry.dataKey === "heartRate" ? "Heart Rate" : entry.dataKey}:
              </span>
              <span className="font-semibold text-[#f1f5f9]">
                {Math.round(entry.value)}
                <span className="text-xs text-[#94a3b8] ml-1">
                  {entry.dataKey === "power"
                    ? "W"
                    : entry.dataKey === "heartRate"
                      ? "bpm"
                      : "rpm"}
                </span>
              </span>
            </div>
          )
      )}
    </div>
  );
}

export function ActivityChart({
  records,
  onSelectionChange,
}: ActivityChartProps) {
  const data: ChartDataPoint[] = useMemo(
    () =>
      records.map((r) => ({
        elapsedSeconds: r.elapsedSeconds,
        power: r.power,
        heartRate: r.heartRate,
        cadence: r.cadence,
      })),
    [records]
  );

  const hasPower = useMemo(
    () => records.some((r) => r.power !== null),
    [records]
  );
  const hasHeartRate = useMemo(
    () => records.some((r) => r.heartRate !== null),
    [records]
  );
  const hasCadence = useMemo(
    () => records.some((r) => r.cadence !== null),
    [records]
  );

  // --- Rubber-band (marquee) selection state ---
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const isDragging = useRef(false);

  // Map an elapsedSeconds value to the nearest data index
  const secondsToIndex = useCallback(
    (seconds: number): number => {
      let closest = 0;
      let minDiff = Infinity;
      for (let i = 0; i < records.length; i++) {
        const diff = Math.abs(records[i].elapsedSeconds - seconds);
        if (diff < minDiff) {
          minDiff = diff;
          closest = i;
        }
      }
      return closest;
    },
    [records]
  );

  const handleMouseDown = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      if (e && e.activeLabel !== undefined) {
        isDragging.current = true;
        setDragStart(e.activeLabel);
        setDragEnd(e.activeLabel);
        setSelection(null);
        onSelectionChange(null);
      }
    },
    [onSelectionChange]
  );

  const handleMouseMove = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      if (isDragging.current && e && e.activeLabel !== undefined) {
        setDragEnd(e.activeLabel);
      }
    },
    []
  );

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

  // Compute Y-axis domains with some padding
  const powerDomain = useMemo(() => {
    if (!hasPower) return [0, 400];
    const powers = records.filter((r) => r.power !== null).map((r) => r.power!);
    return [0, Math.ceil(Math.max(...powers) * 1.1 / 50) * 50];
  }, [records, hasPower]);

  const hrCadDomain = useMemo(() => {
    const values: number[] = [];
    if (hasHeartRate)
      values.push(
        ...records.filter((r) => r.heartRate !== null).map((r) => r.heartRate!)
      );
    if (hasCadence)
      values.push(
        ...records.filter((r) => r.cadence !== null).map((r) => r.cadence!)
      );
    if (values.length === 0) return [0, 200];
    return [
      Math.floor(Math.min(...values) * 0.9 / 10) * 10,
      Math.ceil(Math.max(...values) * 1.1 / 10) * 10,
    ];
  }, [records, hasHeartRate, hasCadence]);

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
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[#8b5cf6]" />
                <span className="text-xs font-medium text-[#94a3b8]">
                  Power (W)
                </span>
              </div>
            )}
            {hasHeartRate && (
              <div className="flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5 text-[#ef4444]" />
                <span className="text-xs font-medium text-[#94a3b8]">
                  Heart Rate (bpm)
                </span>
              </div>
            )}
            {hasCadence && (
              <div className="flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-[#06b6d4]" />
                <span className="text-xs font-medium text-[#94a3b8]">
                  Cadence (rpm)
                </span>
              </div>
            )}
          </div>

          {selection ? (
            <button
              onClick={clearSelection}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#94a3b8] hover:text-[#f1f5f9] bg-[#1a1533]/60 hover:bg-[#8b5cf6]/20 border border-[rgba(139,92,246,0.2)] rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              Clear selection
            </button>
          ) : (
            <span className="text-xs text-[#94a3b8]/60 mr-2 select-none">
              Click &amp; drag on chart to select a time range
            </span>
          )}
        </div>

        <div
          style={{ userSelect: "none" }}
          className={isDragging.current ? "cursor-crosshair" : "cursor-crosshair"}
        >
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart
              data={data}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <defs>
                <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
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
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={{ stroke: "rgba(139, 92, 246, 0.1)" }}
                tickLine={{ stroke: "rgba(139, 92, 246, 0.1)" }}
                interval="preserveStartEnd"
                minTickGap={60}
              />

              {hasPower && (
                <YAxis
                  yAxisId="power"
                  orientation="left"
                  domain={powerDomain}
                  stroke="#94a3b8"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={{ stroke: "rgba(139, 92, 246, 0.1)" }}
                  tickLine={false}
                  width={45}
                  label={{
                    value: "W",
                    position: "insideTopLeft",
                    offset: -5,
                    style: { fontSize: 10, fill: "#8b5cf6" },
                  }}
                />
              )}

              {(hasHeartRate || hasCadence) && (
                <YAxis
                  yAxisId="hrCad"
                  orientation="right"
                  domain={hrCadDomain}
                  stroke="#94a3b8"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={{ stroke: "rgba(139, 92, 246, 0.1)" }}
                  tickLine={false}
                  width={45}
                  label={{
                    value: "bpm / rpm",
                    position: "insideTopRight",
                    offset: -5,
                    style: { fontSize: 10, fill: "#94a3b8" },
                  }}
                />
              )}

              <Tooltip content={<CustomTooltip />} />

              {hasPower && (
                <Area
                  yAxisId="power"
                  type="monotone"
                  dataKey="power"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  fill="url(#powerGradient)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#8b5cf6",
                    stroke: "#1a1533",
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

              {hasHeartRate && (
                <Line
                  yAxisId="hrCad"
                  type="monotone"
                  dataKey="heartRate"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#ef4444",
                    stroke: "#1a1533",
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

              {hasCadence && (
                <Line
                  yAxisId={hasHeartRate || hasCadence ? "hrCad" : "power"}
                  type="monotone"
                  dataKey="cadence"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: "#06b6d4",
                    stroke: "#1a1533",
                    strokeWidth: 2,
                  }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

              {/* Rubber-band selection overlay */}
              {refAreaLeft !== null && refAreaRight !== null && (
                <ReferenceArea
                  yAxisId={hasPower ? "power" : "hrCad"}
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
}
