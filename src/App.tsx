import { useState, useCallback, useEffect, useMemo } from "react";
import type { Interval, ParsedActivity } from "./types/fit";
import { computeAverages } from "./lib/stats";
import { Header } from "./components/Header";
import { FileDropZone } from "./components/FileDropZone";
import { ActivityChart } from "./components/ActivityChart";
import { StatsBar } from "./components/StatsBar";
import { IntervalList } from "./components/IntervalList";
import { SummaryCards } from "./components/SummaryCards";
import { CopyBox } from "./components/CopyBox";
import {
  saveActivity,
  loadActivity,
  clearActivity,
  saveCustomIntervals,
  loadCustomIntervals,
  clearCustomIntervals,
  clearIntervalMinutes,
} from "./lib/storage";

function App() {
  const [activity, setActivity] = useState<ParsedActivity | null>(() =>
    loadActivity()
  );
  const [selectionRange, setSelectionRange] = useState<
    [number, number] | null
  >(null);
  const [chartZoom, setChartZoom] = useState<[number, number] | null>(null);
  const [intervalRanges, setIntervalRanges] = useState<[number, number][]>([]);
  const [lapIntervalObjects, setLapIntervalObjects] = useState<Interval[]>([]);
  const [customIntervals, setCustomIntervals] = useState<[number, number][]>(
    () => loadCustomIntervals()
  );

  // Persist activity when it changes
  useEffect(() => {
    if (activity) {
      saveActivity(activity);
    }
  }, [activity]);

  // Persist custom intervals when they change
  useEffect(() => {
    saveCustomIntervals(customIntervals);
  }, [customIntervals]);

  const handleFileParsed = useCallback((data: ParsedActivity) => {
    setActivity(data);
    setSelectionRange(null);
    setChartZoom(null);
    setIntervalRanges([]);
    setLapIntervalObjects([]);
    setCustomIntervals([]);
  }, []);

  const handleReset = useCallback(() => {
    setActivity(null);
    setSelectionRange(null);
    setChartZoom(null);
    setIntervalRanges([]);
    setLapIntervalObjects([]);
    setCustomIntervals([]);
    clearActivity();
    clearCustomIntervals();
    clearIntervalMinutes();
  }, []);

  const handleIntervalClick = useCallback(
    (startSeconds: number, endSeconds: number) => {
      setChartZoom([startSeconds, endSeconds]);
    },
    []
  );

  const handleIntervalsChange = useCallback(
    (intervals: Interval[]) => {
      setIntervalRanges(
        intervals.map((i) => [i.startSeconds, i.endSeconds] as [number, number])
      );
      setLapIntervalObjects(intervals);
    },
    []
  );

  const customIntervalObjects: Interval[] = useMemo(() => {
    if (!activity || customIntervals.length === 0) return [];
    return customIntervals.map((range, idx) => {
      const [start, end] = range;
      const slice = activity.records.filter(
        (r) => r.elapsedSeconds >= start && r.elapsedSeconds <= end
      );
      const stats =
        slice.length > 0
          ? computeAverages(slice)
          : { avgPower: null, avgHeartRate: null, avgCadence: null };
      return {
        index: idx,
        startSeconds: start,
        endSeconds: end,
        avgPower: stats.avgPower,
        avgHeartRate: stats.avgHeartRate,
        avgCadence: stats.avgCadence,
        duration: end - start,
      };
    });
  }, [activity, customIntervals]);

  const handleAddInterval = useCallback(
    (startSeconds: number, endSeconds: number) => {
      setCustomIntervals((prev) => [...prev, [startSeconds, endSeconds]]);
    },
    []
  );

  const handleRemoveCustomInterval = useCallback(
    (index: number) => {
      setCustomIntervals((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  const handleSelectionChange = useCallback(
    (range: [number, number] | null) => {
      setSelectionRange(range);
    },
    []
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0f0b1a]">
      <Header hasData={activity !== null} onReset={handleReset} />

      {!activity ? (
        <FileDropZone onFileParsed={handleFileParsed} />
      ) : (
        <div className="flex-1 flex flex-col pt-6 animate-[fadeIn_0.4s_ease-out]">
          {/* Date header */}
          <div className="px-6 mb-4">
            <h2 className="text-2xl font-bold text-[#f1f5f9]">
              Activity on {activity.summary.date}
            </h2>
            <p className="text-sm text-[#94a3b8] mt-1">
              {activity.records.length.toLocaleString()} data points recorded
            </p>
          </div>

          {/* Selection stats bar */}
          <StatsBar
            records={activity.records}
            selectionRange={selectionRange}
          />

          {/* Interactive chart */}
          <ActivityChart
            records={activity.records}
            onSelectionChange={handleSelectionChange}
            externalZoom={chartZoom}
            intervalRanges={[...intervalRanges, ...customIntervals]}
            onAddInterval={handleAddInterval}
          />

          {/* Interval list */}
          <IntervalList
            records={activity.records}
            laps={activity.laps}
            onIntervalClick={handleIntervalClick}
            onIntervalsChange={handleIntervalsChange}
            customIntervals={customIntervals}
            onRemoveCustomInterval={handleRemoveCustomInterval}
          />

          {/* Summary cards */}
          <SummaryCards summary={activity.summary} />

          {/* Copyable summary box */}
          <CopyBox
            summary={activity.summary}
            intervals={[...lapIntervalObjects, ...customIntervalObjects]}
          />
        </div>
      )}
    </div>
  );
}

export default App;
