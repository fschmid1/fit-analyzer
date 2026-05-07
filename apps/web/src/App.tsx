import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Routes, Route, useNavigate, useMatch } from "react-router-dom";
import type {
	ActivityListItem,
	Interval,
	ParsedActivity,
} from "@fit-analyzer/shared";
import { computeAverages } from "./lib/stats";
import { Header } from "./components/Header";
import { FileDropZone } from "./components/FileDropZone";
import { ActivityHistory } from "./components/ActivityHistory";
import { ActivityChart } from "./components/ActivityChart";
import { StatsBar } from "./components/StatsBar";
import { IntervalList } from "./components/IntervalList";
import { SummaryCards } from "./components/SummaryCards";
import { CopyBox } from "./components/CopyBox";
import { InstallPrompt } from "./components/InstallPrompt";
import { TrainerView } from "./components/TrainerView";
import { SettingsPage } from "./pages/SettingsPage";
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

function App() {
	const navigate = useNavigate();
	const activityMatch = useMatch("/activity/:id");
	const urlActivityId = activityMatch?.params?.id ?? null;

	const [activity, setActivity] = useState<ParsedActivity | null>(null);
	const [activityId, setActivityId] = useState<string | null>(null);
	const [activities, setActivities] = useState<ActivityListItem[]>([]);
	const [historyLoading, setHistoryLoading] = useState(true);
	const [user, setUser] = useState<UserInfo | null>(null);
	const [trainerInitialMessage, setTrainerInitialMessage] = useState("");

	const [selectionRange, setSelectionRange] = useState<[number, number] | null>(
		null,
	);
	const [chartZoom, setChartZoom] = useState<[number, number] | null>(null);
	const [intervalRanges, setIntervalRanges] = useState<[number, number][]>([]);
	const [lapIntervalObjects, setLapIntervalObjects] = useState<Interval[]>([]);
	const [customIntervals, setCustomIntervals] = useState<[number, number][]>(
		() => loadCustomIntervals(),
	);
	const [intervalMinutes, setIntervalMinutes] = useState<string>("");
	const [savedIntervalMinutes, setSavedIntervalMinutes] = useState<string>("");

	// Ref to prevent saving intervals back to DB right after loading them
	const skipNextSave = useRef(false);
	// Track which activity ID has already been loaded to avoid duplicate fetches
	const loadedActivityId = useRef<string | null>(null);

	// Fetch current user on mount
	useEffect(() => {
		fetchCurrentUser().then(setUser);
	}, []);

	// Fetch activity list on mount
	useEffect(() => {
		loadActivities();
	}, []);

	// Restore activity from URL on initial load (e.g. direct link to /activity/:id)
	useEffect(() => {
		if (urlActivityId && urlActivityId !== loadedActivityId.current) {
			loadedActivityId.current = urlActivityId;
			fetchActivity(urlActivityId)
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
				})
				.catch((err) => {
					console.error("Failed to restore activity from URL:", err);
					navigate("/");
				});
		}
	}, [urlActivityId, navigate]);

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

			// Save to server in background
			try {
				const id = await saveActivityToServer(data);
				setActivityId(id);
				loadedActivityId.current = id;
				navigate(`/activity/${id}`);
				// Refresh the list
				const list = await fetchActivities();
				setActivities(list);
			} catch (err) {
				console.error("Failed to save activity to server:", err);
			}
		},
		[resetAnalysisState, navigate],
	);

	const handleSelectActivity = useCallback(
		async (id: string) => {
			try {
				const data = await fetchActivity(id);
				setActivity(data);
				setActivityId(data.id);
				loadedActivityId.current = data.id;

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

				setLapIntervalObjects([]);
				setIntervalRanges([]);

				navigate(`/activity/${data.id}`);
			} catch (err) {
				console.error("Failed to load activity:", err);
			}
		},
		[navigate],
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
		loadedActivityId.current = null;
		resetAnalysisState();
		navigate("/");
		loadActivities();
	}, [resetAnalysisState, navigate]);

	const handleUploadNew = useCallback(() => {
		navigate("/upload");
	}, [navigate]);

	const handleIntervalClick = useCallback(
		(startSeconds: number, endSeconds: number) => {
			setChartZoom([startSeconds, endSeconds]);
		},
		[],
	);

	const handleIntervalsChange = useCallback((intervals: Interval[]) => {
		setIntervalRanges(
			intervals.map((i) => [i.startSeconds, i.endSeconds] as [number, number]),
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
	}, [activity, customIntervals]);

	const handleAddInterval = useCallback(
		(startSeconds: number, endSeconds: number) => {
			setCustomIntervals((prev) => [...prev, [startSeconds, endSeconds]]);
		},
		[],
	);

	const handleRemoveCustomInterval = useCallback((index: number) => {
		setCustomIntervals((prev) => prev.filter((_, i) => i !== index));
	}, []);

	// Persist all intervals to DB when they change
	const allIntervals = useMemo(
		() => [...lapIntervalObjects, ...customIntervalObjects],
		[lapIntervalObjects, customIntervalObjects],
	);

	useEffect(() => {
		if (!activityId) return;

		if (skipNextSave.current) {
			skipNextSave.current = false;
			return;
		}

		if (allIntervals.length > 0 || customIntervals.length > 0) {
			updateIntervals(
				activityId,
				allIntervals,
				intervalMinutes,
				customIntervals,
			).catch((err) => console.error("Failed to save intervals:", err));
		}
	}, [activityId, allIntervals, intervalMinutes, customIntervals]);

	const handleSelectionChange = useCallback(
		(range: [number, number] | null) => {
			setSelectionRange(range);
		},
		[],
	);

	const handleSendToTrainer = useCallback(
		(text: string) => {
			setTrainerInitialMessage(text);
			navigate("/trainer");
		},
		[navigate],
	);

	const handleOpenTrainer = useCallback(() => {
		setTrainerInitialMessage("");
		navigate("/trainer");
	}, [navigate]);

	// Analysis view content extracted for use in the Route element
	const analysisContent = activity ? (
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
			<StatsBar records={activity.records} selectionRange={selectionRange} />

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
				onSendToTrainer={handleSendToTrainer}
			/>
		</div>
	) : null;

	return (
		<div className="min-h-screen flex flex-col bg-[#0f0b1a]">
			<Header
				onBackToHistory={handleBackToHistory}
				onUploadNew={handleUploadNew}
				onOpenTrainer={handleOpenTrainer}
				user={user}
			/>

			<Routes>
				<Route
					path="/"
					element={
						<ActivityHistory
							activities={activities}
							loading={historyLoading}
							onSelect={handleSelectActivity}
							onDelete={handleDeleteActivity}
							onUploadNew={handleUploadNew}
						/>
					}
				/>
				<Route
					path="/upload"
					element={<FileDropZone onFileParsed={handleFileParsed} />}
				/>
				<Route path="/activity/:id" element={analysisContent} />
				<Route
					path="/trainer"
					element={
						<TrainerView
							initialMessage={trainerInitialMessage}
							activityId="general"
							onBack={() => navigate(-1)}
						/>
					}
				/>
				<Route
					path="/settings"
					element={
						<SettingsPage user={user} onActivitiesChanged={loadActivities} />
					}
				/>
			</Routes>
			<InstallPrompt />
		</div>
	);
}

export default App;
