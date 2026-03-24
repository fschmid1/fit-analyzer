import { memo, useCallback, useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Brush,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Zap, Heart, Gauge } from "lucide-react";
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

// Stable config objects (hoisted outside component to avoid re-creation)
const CHART_MARGIN = { top: 5, right: 10, left: 10, bottom: 5 };
const AXIS_TICK = { fontSize: 11, fill: "#94a3b8" };
const AXIS_LINE = { stroke: "rgba(139, 92, 246, 0.1)" };
const TICK_LINE = { stroke: "rgba(139, 92, 246, 0.1)" };
const POWER_LABEL = {
  value: "W",
  position: "insideTopLeft" as const,
  offset: -5,
  style: { fontSize: 10, fill: "#8b5cf6" },
};
const HR_CAD_LABEL = {
  value: "bpm / rpm",
  position: "insideTopRight" as const,
  offset: -5,
  style: { fontSize: 10, fill: "#94a3b8" },
};
const POWER_ACTIVE_DOT = { r: 4, fill: "#8b5cf6", stroke: "#1a1533", strokeWidth: 2 };
const HR_ACTIVE_DOT = { r: 4, fill: "#ef4444", stroke: "#1a1533", strokeWidth: 2 };
const CAD_ACTIVE_DOT = { r: 4, fill: "#06b6d4", stroke: "#1a1533", strokeWidth: 2 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = memo(function CustomTooltip({ active, payload, label }: any) {
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
});

export const ActivityChart = memo(function ActivityChart({
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

  const handleBrushChange = useCallback(
    (brushRange: { startIndex?: number; endIndex?: number }) => {
      if (
        brushRange.startIndex !== undefined &&
        brushRange.endIndex !== undefined
      ) {
        onSelectionChange([brushRange.startIndex, brushRange.endIndex]);
      }
    },
    [onSelectionChange]
  );

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

  return (
    <div className="px-6 pb-4">
      <div className="bg-[#1a1533]/40 backdrop-blur-md border border-[rgba(139,92,246,0.1)] rounded-2xl p-4 pt-6">
        {/* Legend */}
        <div className="flex items-center gap-6 mb-4 ml-12">
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

        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart
            data={data}
            margin={CHART_MARGIN}
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
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={TICK_LINE}
              interval="preserveStartEnd"
              minTickGap={60}
            />

            {hasPower && (
              <YAxis
                yAxisId="power"
                orientation="left"
                domain={powerDomain}
                stroke="#94a3b8"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={45}
                label={POWER_LABEL}
              />
            )}

            {(hasHeartRate || hasCadence) && (
              <YAxis
                yAxisId="hrCad"
                orientation="right"
                domain={hrCadDomain}
                stroke="#94a3b8"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={45}
                label={HR_CAD_LABEL}
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
                activeDot={POWER_ACTIVE_DOT}
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
                activeDot={HR_ACTIVE_DOT}
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
                activeDot={CAD_ACTIVE_DOT}
                connectNulls
                isAnimationActive={false}
              />
            )}

            <Brush
              dataKey="elapsedSeconds"
              height={36}
              stroke="#8b5cf6"
              fill="#0f0b1a"
              travellerWidth={10}
              tickFormatter={formatElapsedTime}
              onChange={handleBrushChange}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
