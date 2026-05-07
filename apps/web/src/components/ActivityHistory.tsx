import { useState } from "react";
import { Clock, Zap, Heart, Route, Trash2, Loader2 } from "lucide-react";
import type { ActivityListItem } from "@fit-analyzer/shared";

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
	const date = new Date(dateStr + "T00:00:00");
	return date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function ActivityHistory({
	activities,
	loading,
	onSelect,
	onDelete,
	onUploadNew,
}: ActivityHistoryProps) {
	const [deletingId, setDeletingId] = useState<string | null>(null);

	const handleDelete = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		setDeletingId(id);
		onDelete(id);
	};

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
				<button
					onClick={onUploadNew}
					className="px-6 py-3 text-sm font-medium text-white bg-[#8b5cf6] hover:bg-[#7c3aed] rounded-xl transition-colors duration-200 cursor-pointer"
				>
					Upload FIT File
				</button>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col p-6 animate-[fadeIn_0.4s_ease-out]">
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
				<button
					onClick={onUploadNew}
					className="px-4 py-2 text-sm font-medium text-white bg-[#8b5cf6] hover:bg-[#7c3aed] rounded-xl transition-colors duration-200 cursor-pointer"
				>
					Upload New
				</button>
			</div>

			<div className="flex flex-col gap-3">
				{activities.map((activity) => (
					<div
						key={activity.id}
						onClick={() => onSelect(activity.id)}
						className="group flex items-center gap-4 p-4 bg-[#1a1533]/70 hover:bg-[#241e3d] border border-[rgba(139,92,246,0.1)] hover:border-[rgba(139,92,246,0.25)] rounded-xl transition-all duration-200 cursor-pointer text-left w-full"
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onSelect(activity.id);
							}
						}}
					>
						{/* Date */}
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
										>
											<path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
										</svg>
									</span>
								)}
							</div>
							<div className="flex items-center gap-4 mt-1.5">
								{/* Duration */}
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

								{/* Avg Power */}
								{activity.summary.avgPower !== null && (
									<span className="flex items-center gap-1 text-xs text-[#8b5cf6]">
										<Zap className="w-3 h-3" />
										{activity.summary.avgPower}W avg
									</span>
								)}

								{/* Max Power */}
								{activity.summary.maxPower !== null && (
									<span className="text-xs text-[#8b5cf6]/70">
										{activity.summary.maxPower}W max
									</span>
								)}

								{/* Avg HR */}
								{activity.summary.avgHeartRate !== null && (
									<span className="flex items-center gap-1 text-xs text-[#ef4444]">
										<Heart className="w-3 h-3" />
										{activity.summary.avgHeartRate} bpm
									</span>
								)}
							</div>
						</div>

						{/* Delete button */}
						<button
							type="button"
							onClick={(e) => handleDelete(e, activity.id)}
							aria-label={`Delete activity from ${formatDate(activity.summary.date)}`}
							className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 shrink-0 p-2 text-[#94a3b8] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all duration-200"
						>
							{deletingId === activity.id ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Trash2 className="w-4 h-4" />
							)}
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
