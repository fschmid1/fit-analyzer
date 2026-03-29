import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
  saveIntervalMinutes,
} from "./lib/storage";
import {
  fetchActivities,
  fetchActivity,
  saveActivityToServer,
  deleteActivity,
  updateIntervals,
  fetchCurrentUser,
} from "./lib/api";
import type { UserInfo } from "./lib/api";

type View = "history" | "upload" | "analysis";

/** Parse the URL hash to determine the initial view and activity ID */
function parseHash(): { view: View; activityId: string | null } {
  const hash = window.location.hash;
  if (hash.startsWith("#/activity/")) {
    const id = hash.slice("#/activity/".length);
    if (id) return { view: "analysis", activityId: id };
  }
  if (hash === "#/upload") {
    return { view: "upload", activityId: null };
  }
  return { view: "history", activityId: null };
}

/** Update the URL hash without triggering a page reload */
function setHash(view: View, activityId?: string | null) {
  if (view === "analysis" && activityId) {
    window.location.hash = `/activity/${activityId}`;
  } else if (view === "upload") {
    window.location.hash = "/upload";
  } else {
    // Use replaceState to clear hash cleanly (avoids scroll-to-top)
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function App() {
  const initialRoute = useRef(parseHash());
  const [view, setView] = useState<View>(initialRoute.current.view);
  const [activity, setActivity] = useState<ParsedActivity | null>(null);
  const [activityId, setActivityId] = useState<string | null>(initialRoute.current.activityId);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);

  const [selectionRange, setSelectionRange] = useState<
    [number, number] | null
  >(null);
  const [chartZoom, setChartZoom] = useState<[number, number] | null>(null);
  const [intervalRanges, setIntervalRanges] = useState<[number, number][]>([]);
  const [lapIntervalObjects, setLapIntervalObjects] = useState<Interval[]>([]);
  const [customIntervals, setCustomIntervals] = useState<[number, number][]>(
    () => loadCustomIntervals()
  );
  const [intervalMinutes, setIntervalMinutes] = useState<string>("");
  // Track the initial interval minutes to pass to IntervalList on mount
  const [savedIntervalMinutes, setSavedIntervalMinutes] = useState<string>("");

  // Ref to prevent saving intervals back to DB right after loading them
  const skipNextSave = useRef(false);

  // Fetch current user on mount
  useEffect(() => {
    fetchCurrentUser().then(setUser);
  }, []);

  // Fetch activity list on mount + restore activity from URL hash
  useEffect(() => {
    loadActivities();

    const { activityId: hashId } = initialRoute.current;
    if (hashId) {
      // Restore the activity that was in the URL
      fetchActivity(hashId)
        .then((data) => {
          setActivity(data);
          setActivityId(data.id);

          const mins = data.intervalMinutes || "";
          setSavedIntervalMinutes(mins);
          setIntervalMinutes(mins);
          if (mins) saveIntervalMinutes(mins);

          if (data.customRanges && data.customRanges.length > 0) {
            setCustomIntervals(data.customRanges);
          } else {
            setCustomIntervals([]);
            clearCustomIntervals();
          }

          skipNextSave.current = true;
          setLapIntervalObjects([]);
          setIntervalRanges([]);
          setView("analysis");
        })
        .catch((err) => {
          console.error("Failed to restore activity from URL:", err);
          setView("history");
          setHash("history");
        });
    }
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

  // Persist custom intervals to localStorage
  useEffect(() => {
    saveCustomIntervals(customIntervals);
  }, [customIntervals]);

  const resetAnalysisState = useCallback(() => {
    setSelectionRange(null);
    setChartZoom(null);
    setIntervalRanges([]);
    setLapIntervalObjects([]);
    setCustomIntervals([]);
    setIntervalMinutes("");
    setSavedIntervalMinutes("");
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
        setHash("analysis", id);
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

        // Reset selection/zoom state
        setSelectionRange(null);
        setChartZoom(null);

        // Restore saved interval config from DB
        const mins = data.intervalMinutes || "";
        setSavedIntervalMinutes(mins);
        setIntervalMinutes(mins);
        if (mins) {
          saveIntervalMinutes(mins);
        }

        // Restore custom intervals from DB
        if (data.customRanges && data.customRanges.length > 0) {
          setCustomIntervals(data.customRanges);
        } else {
          setCustomIntervals([]);
          clearCustomIntervals();
        }

        // Skip saving intervals back to DB when IntervalList recomputes on mount
        skipNextSave.current = true;

        // The lap intervals will be recomputed by IntervalList from laps + intervalMinutes
        setLapIntervalObjects([]);
        setIntervalRanges([]);

        setView("analysis");
        setHash("analysis", data.id);
      } catch (err) {
        console.error("Failed to load activity:", err);
      }
    },
    []
  );

  // Handle browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const { view: newView, activityId: newId } = parseHash();
      if (newView === "analysis" && newId) {
        handleSelectActivity(newId);
      } else if (newView === "upload") {
        setView("upload");
        setActivity(null);
        setActivityId(null);
      } else {
        setActivity(null);
        setActivityId(null);
        resetAnalysisState();
        setView("history");
        loadActivities();
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [handleSelectActivity, resetAnalysisState]);

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
    setHash("history");
    loadActivities();
  }, [resetAnalysisState]);

  const handleUploadNew = useCallback(() => {
    setView("upload");
    setHash("upload");
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

  const handleIntervalMinutesChange = useCallback((minutes: string) => {
    setIntervalMinutes(minutes);
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

  // Persist all intervals to DB when they change
  const allIntervals = useMemo(
    () => [...lapIntervalObjects, ...customIntervalObjects],
    [lapIntervalObjects, customIntervalObjects]
  );

  useEffect(() => {
    if (!activityId) return;

    // Skip the first save after loading from DB (IntervalList recomputes on mount)
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    if (allIntervals.length > 0 || customIntervals.length > 0) {
      updateIntervals(
        activityId,
        allIntervals,
        intervalMinutes,
        customIntervals
      ).catch((err) => console.error("Failed to save intervals:", err));
    }
  }, [activityId, allIntervals, intervalMinutes, customIntervals]);

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
        user={user}
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
            onIntervalMinutesChange={handleIntervalMinutesChange}
            customIntervals={customIntervals}
            onRemoveCustomInterval={handleRemoveCustomInterval}
            initialIntervalMinutes={savedIntervalMinutes}
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
