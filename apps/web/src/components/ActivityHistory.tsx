import { useState, useRef, useCallback } from "react";
import { useDrag } from "@use-gesture/react";
import { useSpring, animated } from "@react-spring/web";
import { Clock, Zap, Heart, Route, Trash2, Loader2 } from "lucide-react";
import type { ActivityListItem } from "@fit-analyzer/shared";
import { AnimatedButton } from "./AnimatedButton";

interface ActivityHistoryProps {
	activities: ActivityListItem[];
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

interface SwipeableRowProps {
	activity: ActivityListItem;
	isDeleting: boolean;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}

function SwipeableRow({
	activity,
	isDeleting,
	onSelect,
	onDelete,
}: SwipeableRowProps) {
	const swipeRef = useRef<HTMLDivElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [springStyle, springApi] = useSpring(() => ({
		x: 0,
		config: { friction: 26, tension: 300 },
	}));

	useDrag(
		({ active, movement: [mx], direction: [dx], velocity: [vx] }) => {
			const minSwipe = 60;
			const velocityThreshold = 0.3;

			if (!active) {
				let nextOpen = isOpen;
				if (Math.abs(mx) > minSwipe || Math.abs(vx) > velocityThreshold) {
					nextOpen = dx < 0;
					setIsOpen(nextOpen);
				}
				springApi.start({ x: nextOpen ? -80 : 0 });
			} else {
				const targetX = isOpen ? mx - 80 : mx;
				const clamped = Math.max(-80, Math.min(targetX, 0));
				springApi.start({ x: clamped, immediate: true });
			}
		},
		{
			target: swipeRef,
			axis: "x",
			bounds: { left: -80, right: 80 },
			rubberband: true,
			preventScroll: true,
			preventScrollAxis: "y",
		},
	);

	return (
		<div className="relative overflow-hidden rounded-xl border border-[rgba(139,92,246,0.1)] bg-[#1a1533]/70 group">
			<div className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 bg-red-500/10">
				<AnimatedButton
					onClick={() => onDelete(activity.id)}
					aria-label={`Delete activity from ${formatDate(activity.summary.date)}`}
					className="rounded-lg p-2 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
				>
					{isDeleting ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Trash2 className="w-4 h-4" />
					)}
				</AnimatedButton>
			</div>

			<animated.div
				ref={swipeRef}
				style={{ touchAction: "pan-y", ...springStyle }}
				className="relative z-10 flex items-center gap-3 bg-[#1a1533]"
			>
				<AnimatedButton
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
				</AnimatedButton>

				<AnimatedButton
					onClick={() => onDelete(activity.id)}
					aria-label={`Delete activity from ${formatDate(activity.summary.date)}`}
					className="mr-3 hidden shrink-0 rounded-lg p-2 text-[#94a3b8] transition-opacity duration-200 hover:bg-red-500/10 hover:text-red-400 sm:flex sm:opacity-0 sm:group-hover:opacity-100"
				>
					{isDeleting ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Trash2 className="w-4 h-4" />
					)}
				</AnimatedButton>
			</animated.div>
		</div>
	);
}

export function ActivityHistory({
	activities,
	loading,
	onSelect,
	onDelete,
	onUploadNew,
}: ActivityHistoryProps) {
	const [deletingId, setDeletingId] = useState<string | null>(null);

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

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<Loader2 className="w-8 h-8 text-[#8b5cf6] animate-spin" />
			</div>
		);
	}

	if (activities.length === 0) {
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
					</p>
				</div>
				<AnimatedButton
					onClick={onUploadNew}
					className="px-4 py-2 text-sm font-medium text-white bg-[#8b5cf6] hover:bg-[#7c3aed] rounded-xl transition-colors duration-200 cursor-pointer"
				>
					Upload New
				</AnimatedButton>
			</div>

			<div className="flex flex-col gap-3">
				{activities.map((activity) => (
					<SwipeableRow
						key={activity.id}
						activity={activity}
						isDeleting={deletingId === activity.id}
						onSelect={onSelect}
						onDelete={handleDelete}
					/>
				))}
			</div>
		</div>
	);
}
