import { useState, useMemo, useCallback, useEffect } from "react";
import { Timer, Zap, Heart, Gauge, ChevronRight } from "lucide-react";
import type { ActivityRecord, LapMarker, Interval } from "../types/fit";
import { computeIntervals } from "../lib/stats";
import { formatElapsedTime } from "../lib/formatters";

interface IntervalListProps {
  records: ActivityRecord[];
  laps: LapMarker[];
  onIntervalClick: (startSeconds: number, endSeconds: number) => void;
  onIntervalsChange: (intervals: Interval[]) => void;
}

export function IntervalList({
  records,
  laps,
  onIntervalClick,
  onIntervalsChange,
}: IntervalListProps) {
  const [intervalMinutes, setIntervalMinutes] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const intervalSeconds = useMemo(() => {
    const mins = parseFloat(intervalMinutes);
    if (isNaN(mins) || mins <= 0) return 0;
    return Math.round(mins * 60);
  }, [intervalMinutes]);

  const intervals: Interval[] = useMemo(() => {
    if (intervalSeconds <= 0) return [];
    return computeIntervals(records, laps, intervalSeconds);
  }, [records, laps, intervalSeconds]);

  useEffect(() => {
    onIntervalsChange(intervals);
  }, [intervals, onIntervalsChange]);

  const handleClick = useCallback(
    (interval: Interval) => {
      setActiveIndex(interval.index);
      onIntervalClick(interval.startSeconds, interval.endSeconds);
    },
    [onIntervalClick]
  );

  if (laps.length === 0) return null;

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
            <span className="text-xs text-[#94a3b8]">
              ({laps.length} lap{laps.length !== 1 ? "s" : ""} detected)
            </span>
          </div>
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
                setActiveIndex(null);
              }}
              className="w-20 px-2.5 py-1.5 text-xs font-medium text-[#f1f5f9] bg-[#1a1533]/80 border border-[rgba(139,92,246,0.25)] rounded-lg placeholder-[#94a3b8]/50 focus:outline-none focus:border-[#8b5cf6]/60 focus:ring-1 focus:ring-[#8b5cf6]/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-[#94a3b8]">min</span>
          </div>
        </div>

        {/* Interval list */}
        {intervals.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
            {/* Table header */}
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

            {intervals.map((interval) => (
              <button
                key={interval.index}
                onClick={() => handleClick(interval)}
                className={`w-full grid grid-cols-[2.5rem_1fr_1fr_4.5rem_4.5rem_4.5rem_1.25rem] gap-2 px-3 py-2 text-xs rounded-lg transition-colors cursor-pointer ${
                  activeIndex === interval.index
                    ? "bg-[#8b5cf6]/20 border border-[#8b5cf6]/40 text-[#f1f5f9]"
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
                  {interval.avgPower ?? "—"}
                </span>
                <span className="text-right font-semibold text-[#ef4444]">
                  {interval.avgHeartRate ?? "—"}
                </span>
                <span className="text-right font-semibold text-[#06b6d4]">
                  {interval.avgCadence ?? "—"}
                </span>
                <ChevronRight
                  className={`w-3 h-3 transition-colors ${
                    activeIndex === interval.index
                      ? "text-[#8b5cf6]"
                      : "text-[#94a3b8]/30"
                  }`}
                />
              </button>
            ))}
          </div>
        )}

        {intervalSeconds > 0 && intervals.length === 0 && (
          <p className="text-xs text-[#94a3b8]/60 text-center py-4">
            No intervals found for this length
          </p>
        )}

        {intervalSeconds === 0 && (
          <p className="text-xs text-[#94a3b8]/60 text-center py-4">
            Set an interval length to split laps into intervals
          </p>
        )}
      </div>
    </div>
  );
}
