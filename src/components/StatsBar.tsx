import { useMemo } from "react";
import { Zap, Heart, Gauge, Clock } from "lucide-react";
import type { ActivityRecord } from "../types/fit";
import { computeAverages } from "../lib/stats";
import { formatElapsedTime } from "../lib/formatters";

interface StatsBarProps {
  records: ActivityRecord[];
  selectionRange: [number, number] | null;
}

export function StatsBar({ records, selectionRange }: StatsBarProps) {
  const stats = useMemo(() => {
    if (!selectionRange) return null;
    const [start, end] = selectionRange;
    return computeAverages(records.slice(start, end + 1));
  }, [records, selectionRange]);

  if (!stats) return null;

  const items = [
    {
      icon: Clock,
      label: "Duration",
      value: formatElapsedTime(stats.duration),
      color: "#a78bfa",
    },
    {
      icon: Zap,
      label: "Avg Power",
      value: stats.avgPower !== null ? `${stats.avgPower} W` : "N/A",
      color: "#8b5cf6",
    },
    {
      icon: Heart,
      label: "Avg HR",
      value:
        stats.avgHeartRate !== null ? `${stats.avgHeartRate} bpm` : "N/A",
      color: "#ef4444",
    },
    {
      icon: Gauge,
      label: "Avg Cadence",
      value:
        stats.avgCadence !== null ? `${stats.avgCadence} rpm` : "N/A",
      color: "#06b6d4",
    },
  ];

  return (
    <div className="mx-6 mb-4 p-4 bg-[#1a1533]/80 backdrop-blur-md border border-[#8b5cf6]/20 rounded-2xl shadow-[0_0_30px_rgba(139,92,246,0.1)] animate-[fadeIn_0.3s_ease-out]">
      <p className="text-xs font-medium text-[#8b5cf6] uppercase tracking-wider mb-3">
        Selected Range
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5">
            <item.icon
              className="w-4 h-4 shrink-0"
              style={{ color: item.color }}
            />
            <div>
              <p className="text-[10px] text-[#94a3b8] uppercase tracking-wider">
                {item.label}
              </p>
              <p className="text-sm font-bold text-[#f1f5f9]">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
