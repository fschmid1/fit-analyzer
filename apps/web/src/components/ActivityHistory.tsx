import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useDrag } from "@use-gesture/react";
import {
	Activity,
	Clock,
	Dumbbell,
	Flame,
	Footprints,
	Heart,
	Loader2,
	Route,
	Trash2,
	Waves,
	Zap,
} from "lucide-react";
import type {
	ActivityListItem,
	CrossTrainingSession,
} from "@fit-analyzer/shared";
import { AnimatedButton } from "./AnimatedButton";

interface ActivityHistoryProps {
	activities: ActivityListItem[];
	/** Completed non-ride sessions (gym, runs, swims) from intervals.icu. */
	sessions: CrossTrainingSession[];
	loading: boolean;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
	onUploadNew: () => void;
}

function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

function formatDate(dateStr: string): string {
	const date = new Date(`${dateStr}T00:00:00`);
	return date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

const SPORT_LABELS: Record<string, string> = {
	WeightTraining: "Strength",
	Crossfit: "CrossFit",
	Run: "Run",
	Swim: "Swim",
	Rowing: "Row",
	Yoga: "Yoga",
	Walk: "Walk",
	Hike: "Hike",
	Workout: "Workout",
};

function sportLabel(sport: string): string {
	return SPORT_LABELS[sport] ?? sport;
}

function SportIcon({ sport }: { sport: string }) {
	const className = "w-4 h-4 text-[#a78bfa]";
	if (sport === "WeightTraining" || sport === "Crossfit")
		return <Dumbbell className={className} />;
	if (sport === "Run" || sport === "Walk" || sport === "Hike")
		return <Footprints className={className} />;
	if (sport === "Swim" || sport === "Rowing")
		return <Waves className={className} />;
	return <Activity className={className} />;
}

/** One imported non-ride session. Read-only: intervals.icu owns the data. */
function SessionRow({ session }: { session: CrossTrainingSession }) {
	return (
		<div className="flex items-center gap-3 rounded-xl border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 p-3.5">
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#8b5cf6]/15">
				<SportIcon sport={session.sport} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<p className="truncate text-sm font-medium text-[#f1f5f9]">
						{session.name}
					</p>
					<span className="shrink-0 rounded-md border border-[#8b5cf6]/10 bg-[#8b5cf6]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#c4b5fd]">
						{sportLabel(session.sport)}
					</span>
				</div>
				<p className="mt-0.5 text-xs text-[#94a3b8]">
					{formatDate(session.date)}
					{session.startTime ? ` · ${session.startTime}` : ""}
				</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<span className="flex items-center gap-1 text-[#94a3b8]">
						<Clock className="w-3 h-3" />
						{formatDuration(session.durationSeconds)}
					</span>
					{session.distanceKm != null && (
						<span className="flex items-center gap-1 text-[#22c55e]">
							<Route className="w-3 h-3" />
							{session.distanceKm} km
						</span>
					)}
					{session.avgHeartRate != null && (
						<span className="flex items-center gap-1 text-[#ef4444]">
							<Heart className="w-3 h-3" />
							{session.avgHeartRate} bpm
						</span>
					)}
					{session.trainingLoad != null && (
						<span className="flex items-center gap-1 text-[#f59e0b]">
							<Flame className="w-3 h-3" />
							{Math.round(session.trainingLoad)} load
						</span>
					)}
					{session.kgLifted != null && (
						<span className="flex items-center gap-1 text-[#c4b5fd]">
							<Dumbbell className="w-3 h-3" />
							{Math.round(session.kgLifted).toLocaleString("en-US")} kg
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

interface SwipeableRowProps {
	activity: ActivityListItem;
	isDeleting: boolean;
	onSelect: (id: string) => void;
	onRequestDelete: (id: string) => void;
}

function SwipeableRow({
	activity,
	isDeleting,
	onSelect,
	onRequestDelete,
}: SwipeableRowProps) {
	const swipeRef = useRef<HTMLDivElement>(null);

	useDrag(
		({ active, movement: [mx], velocity: [vx] }) => {
			const el = swipeRef.current;
			if (!el) return;
			const minSwipe = 60;
			const velocityThreshold = 0.3;

			if (!active) {
				const shouldTrigger =
					Math.abs(mx) > minSwipe || Math.abs(vx) > velocityThreshold;
				if (shouldTrigger && mx < 0) {
					onRequestDelete(activity.id);
				}
				// Always snap back — confirmation dialog handles the rest.
				el.style.transition = "transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)";
				el.style.transform = "translateX(0px)";
			} else {
				el.style.transition = "none";
				const clamped = Math.max(-80, Math.min(mx, 0));
				el.style.transform = `translateX(${clamped}px)`;
			}
		},
		{
			target: swipeRef,
			axis: "x",
			bounds: { left: -80, right: 80 },
			rubberband: true,
			eventOptions: { passive: false },
		},
	);

	return (
		<div className="relative overflow-hidden rounded-xl border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 group">
			{/* Red tint visible while swiping left */}
			<div className="absolute inset-y-0 right-0 w-20 bg-red-500/10" />

			{/* Swipeable foreground */}
			<div
				ref={swipeRef}
				style={{ touchAction: "pan-y" }}
				className="relative z-10 flex items-center gap-3 bg-[#1a1533]"
			>
				<button
					type="button"
					onClick={() => onSelect(activity.id)}
					className="flex flex-1 items-center gap-4 p-4 text-left cursor-pointer"
				>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<p className="text-sm font-semibold text-[#f1f5f9] truncate">
								{formatDate(activity.summary.date)}
							</p>
							{activity.stravaActivityId && (
								<span title="Imported from Strava" className="shrink-0">
									<svg
										viewBox="0 0 24 24"
										className="w-3.5 h-3.5 fill-[#fc4c02]"
										aria-hidden="true"
									>
										<title>Imported from Strava</title>
										<path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
									</svg>
								</span>
							)}
							{activity.wahooActivityId && (
								<span title="Imported from Wahoo" className="shrink-0">
									<svg
										viewBox="0 0 24 24"
										className="w-3.5 h-3.5 fill-[#1ba9d5]"
										aria-hidden="true"
									>
										<title>Imported from Wahoo</title>
										<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-3-11.5l-2 5.5-2-5.5h-2l3 7h2l3-7h-2zm8 0h-4v7h2v-2.5h2c1.1 0 2-.9 2-2v-.5c0-1.1-.9-2-2-2zm0 2.5h-2v-1h2v1z" />
									</svg>
								</span>
							)}
						</div>
						<div className="flex items-center gap-4 mt-1.5">
							<span className="flex items-center gap-1 text-xs text-[#94a3b8]">
								<Clock className="w-3 h-3" />
								{formatDuration(activity.summary.totalTimerTime)}
							</span>

							{activity.summary.totalDistanceKm !== null && (
								<span className="flex items-center gap-1 text-xs text-[#22c55e]">
									<Route className="w-3 h-3" />
									{activity.summary.totalDistanceKm} km
								</span>
							)}

							{activity.summary.avgPower !== null && (
								<span className="flex items-center gap-1 text-xs text-[#8b5cf6]">
									<Zap className="w-3 h-3" />
									{activity.summary.avgPower}W avg
								</span>
							)}

							{activity.summary.normalizedPower !== null && (
								<span className="flex items-center gap-1 text-xs text-[#a855f7]">
									<Zap className="w-3 h-3" />
									{activity.summary.normalizedPower}W NP
								</span>
							)}

							{activity.summary.maxPower !== null && (
								<span className="text-xs text-[#8b5cf6]/70">
									{activity.summary.maxPower}W max
								</span>
							)}

							{activity.summary.avgHeartRate !== null && (
								<span className="flex items-center gap-1 text-xs text-[#ef4444]">
									<Heart className="w-3 h-3" />
									{activity.summary.avgHeartRate} bpm
								</span>
							)}
						</div>
					</div>
				</button>

				{/* Desktop hover delete button */}
				<AnimatedButton
					onClick={() => onRequestDelete(activity.id)}
					aria-label={`Delete activity from ${formatDate(activity.summary.date)}`}
					className="mr-3 hidden shrink-0 rounded-lg p-2 text-[#94a3b8] transition-opacity duration-200 hover:bg-red-500/10 hover:text-red-400 sm:flex sm:opacity-0 sm:group-hover:opacity-100"
				>
					{isDeleting ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Trash2 className="w-4 h-4" />
					)}
				</AnimatedButton>
			</div>
		</div>
	);
}

export function ActivityHistory({
	activities,
	sessions,
	loading,
	onSelect,
	onDelete,
	onUploadNew,
}: ActivityHistoryProps) {
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const handleDelete = useCallback(
		async (id: string) => {
			setDeletingId(id);
			try {
				await onDelete(id);
			} finally {
				setDeletingId(null);
			}
		},
		[onDelete],
	);

	const confirmDelete = useCallback(
		(id: string) => {
			setConfirmDeleteId(null);
			handleDelete(id);
		},
		[handleDelete],
	);

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<Loader2 className="w-8 h-8 text-[#8b5cf6] animate-spin" />
			</div>
		);
	}

	if (activities.length === 0 && sessions.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
				<div className="text-center">
					<p className="text-lg font-semibold text-[#f1f5f9]">
						No activities yet
					</p>
					<p className="mt-1 text-sm text-[#94a3b8]">
						Upload a .fit file to get started
					</p>
				</div>
				<AnimatedButton
					onClick={onUploadNew}
					className="px-6 py-3 text-sm font-medium text-white bg-[#8b5cf6] hover:bg-[#7c3aed] rounded-xl transition-colors duration-200 cursor-pointer"
				>
					Upload FIT File
				</AnimatedButton>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col p-6 overflow-y-auto animate-[fadeIn_0.4s_ease-out]">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2 className="text-2xl font-bold text-[#f1f5f9]">
						Activity History
					</h2>
					<p className="text-sm text-[#94a3b8] mt-1">
						{activities.length}{" "}
						{activities.length === 1 ? "activity" : "activities"} recorded
						{sessions.length > 0
							? ` · ${sessions.length} cross-training ${
									sessions.length === 1 ? "session" : "sessions"
								}`
							: ""}
					</p>
				</div>
				<AnimatedButton
					onClick={onUploadNew}
					className="px-4 py-2 text-sm font-medium text-white bg-[#8b5cf6] hover:bg-[#7c3aed] rounded-xl transition-colors duration-200 cursor-pointer"
				>
					Upload New
				</AnimatedButton>
			</div>

			{activities.length === 0 ? (
				<p className="text-sm text-[#94a3b8]">
					No rides yet. Upload a .fit file or connect intervals.icu in Settings.
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{activities.map((activity) => (
						<SwipeableRow
							key={activity.id}
							activity={activity}
							isDeleting={deletingId === activity.id}
							onSelect={onSelect}
							onRequestDelete={setConfirmDeleteId}
						/>
					))}
				</div>
			)}

			{sessions.length > 0 && (
				<section className="mt-8">
					<div className="mb-3 flex items-baseline justify-between gap-3">
						<h3 className="text-sm font-semibold uppercase tracking-wide text-[#8b5cf6]">
							Cross-training
						</h3>
						<span className="text-[11px] text-[#7c6fa0]">
							Gym, runs and more from intervals.icu
						</span>
					</div>
					<div className="flex flex-col gap-2">
						{sessions.map((session) => (
							<SessionRow key={session.id} session={session} />
						))}
					</div>
				</section>
			)}

			{confirmDeleteId &&
				createPortal(
					<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
						<div className="w-72 rounded-lg bg-[#1a1533] border border-[rgba(139,92,246,0.2)] shadow-xl shadow-black/40 p-4">
							<p className="text-sm text-[#c4b5fd] mb-4">
								Are you sure you want to delete this activity?
							</p>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setConfirmDeleteId(null)}
									className="px-3 py-1.5 text-xs text-[#94a3b8] hover:text-[#c4b5fd] rounded-lg hover:bg-[#241e3d] transition-colors cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => confirmDelete(confirmDeleteId)}
									className="px-3 py-1.5 text-xs text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors cursor-pointer"
								>
									Delete
								</button>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}
