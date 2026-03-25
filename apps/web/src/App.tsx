import { useState, useCallback, useEffect, useMemo } from "react";
import type { ActivityListItem, Interval, ParsedActivity } from "@fit-analyzer/shared";
import { computeAverages } from "./lib/stats";
import { Header } from "./components/Header";
import { FileDropZone } from "./components/FileDropZone";
import { ActivityHistory } from "./components/ActivityHistory";
import { ActivityChart } from "./components/ActivityChart";
import { StatsBar } from "./components/StatsBar";
import { IntervalList } from "./components/IntervalList";
import { SummaryCards } from "./components/SummaryCards";
import { CopyBox } from "./components/CopyBox";
import {
  saveCustomIntervals,
  loadCustomIntervals,
  clearCustomIntervals,
  clearIntervalMinutes,
} from "./lib/storage";
import {
  fetchActivities,
  fetchActivity,
  saveActivityToServer,
  deleteActivity,
} from "./lib/api";

type View = "history" | "upload" | "analysis";

function App() {
  const [view, setView] = useState<View>("history");
  const [activity, setActivity] = useState<ParsedActivity | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [selectionRange, setSelectionRange] = useState<
    [number, number] | null
  >(null);
  const [chartZoom, setChartZoom] = useState<[number, number] | null>(null);
  const [intervalRanges, setIntervalRanges] = useState<[number, number][]>([]);
  const [lapIntervalObjects, setLapIntervalObjects] = useState<Interval[]>([]);
  const [customIntervals, setCustomIntervals] = useState<[number, number][]>(
    () => loadCustomIntervals()
  );

  // Fetch activity list on mount
  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    setHistoryLoading(true);
    try {
      const list = await fetchActivities();
      setActivities(list);
    } catch (err) {
      console.error("Failed to fetch activities:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Persist custom intervals when they change
  useEffect(() => {
    saveCustomIntervals(customIntervals);
  }, [customIntervals]);

  const resetAnalysisState = useCallback(() => {
    setSelectionRange(null);
    setChartZoom(null);
    setIntervalRanges([]);
    setLapIntervalObjects([]);
    setCustomIntervals([]);
    clearCustomIntervals();
    clearIntervalMinutes();
  }, []);

  const handleFileParsed = useCallback(
    async (data: ParsedActivity) => {
      setActivity(data);
      resetAnalysisState();
      setView("analysis");

      // Save to server in background
      try {
        const id = await saveActivityToServer(data);
        setActivityId(id);
        // Refresh the list
        const list = await fetchActivities();
        setActivities(list);
      } catch (err) {
        console.error("Failed to save activity to server:", err);
      }
    },
    [resetAnalysisState]
  );

  const handleSelectActivity = useCallback(
    async (id: string) => {
      try {
        const data = await fetchActivity(id);
        setActivity(data);
        setActivityId(data.id);
        resetAnalysisState();
        setView("analysis");
      } catch (err) {
        console.error("Failed to load activity:", err);
      }
    },
    [resetAnalysisState]
  );

  const handleDeleteActivity = useCallback(async (id: string) => {
    try {
      await deleteActivity(id);
      setActivities((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete activity:", err);
    }
  }, []);

  const handleBackToHistory = useCallback(() => {
    setActivity(null);
    setActivityId(null);
    resetAnalysisState();
    setView("history");
    loadActivities();
  }, [resetAnalysisState]);

  const handleUploadNew = useCallback(() => {
    setView("upload");
  }, []);

  const handleIntervalClick = useCallback(
    (startSeconds: number, endSeconds: number) => {
      setChartZoom([startSeconds, endSeconds]);
    },
    []
  );

  const handleIntervalsChange = useCallback((intervals: Interval[]) => {
    setIntervalRanges(
      intervals.map(
        (i) => [i.startSeconds, i.endSeconds] as [number, number]
      )
    );
    setLapIntervalObjects(intervals);
  }, []);

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

  const handleRemoveCustomInterval = useCallback((index: number) => {
    setCustomIntervals((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSelectionChange = useCallback(
    (range: [number, number] | null) => {
      setSelectionRange(range);
    },
    []
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0f0b1a]">
      <Header
        view={view}
        onBackToHistory={handleBackToHistory}
        onUploadNew={handleUploadNew}
      />

      {view === "history" && (
        <ActivityHistory
          activities={activities}
          loading={historyLoading}
          onSelect={handleSelectActivity}
          onDelete={handleDeleteActivity}
          onUploadNew={handleUploadNew}
        />
      )}

      {view === "upload" && (
        <FileDropZone onFileParsed={handleFileParsed} />
      )}

      {view === "analysis" && activity && (
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
