import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Routes, Route, useNavigate, useMatch } from "react-router-dom";
import type {
	ActivityListItem,
	Interval,
	ParsedActivity,
} from "@fit-analyzer/shared";
import { Header } from "./components/Header";
import { FileDropZone } from "./components/FileDropZone";
import { ActivityHistory } from "./components/ActivityHistory";
import { AnalysisView } from "./components/AnalysisView";
import { InstallPrompt } from "./components/InstallPrompt";
import { TrainerView } from "./components/TrainerView";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { EventsPage } from "./pages/EventsPage";
import { computeAverages } from "./lib/stats";
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

	const loadActivities = useCallback(async () => {
		setHistoryLoading(true);
		try {
			const list = await fetchActivities();
			setActivities(list);
		} catch (err) {
			console.error("Failed to fetch activities:", err);
		} finally {
			setHistoryLoading(false);
		}
	}, []);

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

			try {
				const id = await saveActivityToServer(data);
				setActivityId(id);
				loadedActivityId.current = id;
				navigate(`/activity/${id}`);
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

				setSelectionRange(null);
				setChartZoom(null);

				const mins = data.intervalMinutes || "";
				setSavedIntervalMinutes(mins);
				setIntervalMinutes(mins);
				if (mins) {
					saveIntervalMinutes(mins);
				}

				if (data.customRanges && data.customRanges.length > 0) {
					setCustomIntervals(data.customRanges);
				} else {
					setCustomIntervals([]);
					clearCustomIntervals();
				}

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
							normalizedPower: null,
							avgHeartRate: null,
							avgCadence: null,
							normalizedCadence: null,
							duration: 0,
						};
			return {
				index: idx,
				startSeconds: start,
				endSeconds: end,
				avgPower: stats.avgPower,
				normalizedPower: stats.normalizedPower,
				avgHeartRate: stats.avgHeartRate,
				avgCadence: stats.avgCadence,
				normalizedCadence: stats.normalizedCadence,
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
	const chartIntervalRanges = useMemo(
		() => [...intervalRanges, ...customIntervals],
		[intervalRanges, customIntervals],
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

	const handleOpenTrainer = useCallback(() => {
		navigate("/trainer");
	}, [navigate]);

	const analysisContent = activity ? (
		<AnalysisView
			activity={activity}
			activityId={activityId ?? ""}
			analysis={null}
			selectionRange={selectionRange}
			chartZoom={chartZoom}
			chartIntervalRanges={chartIntervalRanges}
			allIntervals={allIntervals}
			customIntervals={customIntervals}
			savedIntervalMinutes={savedIntervalMinutes}
			onSelectionChange={handleSelectionChange}
			onIntervalClick={handleIntervalClick}
			onIntervalsChange={handleIntervalsChange}
			onIntervalMinutesChange={handleIntervalMinutesChange}
			onAddInterval={handleAddInterval}
			onRemoveCustomInterval={handleRemoveCustomInterval}
		/>
	) : null;

	return (
		<div className="h-dvh flex flex-col bg-[#0f0b1a] overflow-hidden">
			<Header
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
					path="/trainer/:threadId?"
					element={
						<TrainerView activityId="general" onBack={() => navigate(-1)} />
					}
				/>
				<Route path="/stats" element={<StatsPage />} />
				<Route path="/events" element={<EventsPage />} />
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
