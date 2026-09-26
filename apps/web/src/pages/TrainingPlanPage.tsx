import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertCircle,
	CalendarDays,
	CheckCircle2,
	Loader2,
	RefreshCw,
	Settings2,
} from "lucide-react";
import type { PlanWorkout, TrainingPlanResponse } from "@fit-analyzer/shared";
import { planWeekFor } from "@fit-analyzer/shared";
import { fetchTrainingPlan, refreshTrainingPlan } from "../lib/api";
import { AnimatedButton } from "../components/AnimatedButton";
import { Link } from "react-router-dom";

/** Group workouts into Mon–Sun Plan weeks, oldest week first. */
function groupByWeek(
	workouts: PlanWorkout[],
): { key: string; start: string; end: string; workouts: PlanWorkout[] }[] {
	const weeks = new Map<
		string,
		{ key: string; start: string; end: string; workouts: PlanWorkout[] }
	>();
	for (const w of workouts) {
		const week = planWeekFor(w.date);
		const entry = weeks.get(week.key) ?? { ...week, workouts: [] };
		entry.workouts.push(w);
		weeks.set(week.key, entry);
	}
	return [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function formatDay(date: string): string {
	return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
		weekday: "long",
		month: "short",
		day: "numeric",
	});
}

function WorkoutRow({ workout }: { workout: PlanWorkout }) {
	return (
		<li className="flex items-start gap-3 py-2.5 border-b border-[rgba(139,92,246,0.08)] last:border-0">
			<span className="w-16 shrink-0 text-xs font-mono text-[#c4b5fd] pt-0.5">
				{workout.startTime}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-[#f1f5f9]">
					{workout.focus}
					{workout.edited && (
						<span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300/80">
							edited
						</span>
					)}
				</p>
				<p className="text-xs text-[#94a3b8] mt-0.5">
					{workout.durationMinutes} min
					{workout.description ? ` · ${workout.description}` : ""}
				</p>
			</div>
		</li>
	);
}

export function TrainingPlanPage() {
	const [plan, setPlan] = useState<TrainingPlanResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setPlan(await fetchTrainingPlan());
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load plan");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		setError(null);
		setNotice(null);
		try {
			const result = await refreshTrainingPlan();
			setPlan(result.plan);
			setNotice(`Plan refreshed for ${result.weekKey}.`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to refresh plan");
		} finally {
			setRefreshing(false);
		}
	}, []);

	const weeks = useMemo(() => groupByWeek(plan?.workouts ?? []), [plan]);

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<div className="flex flex-col items-center gap-4 text-[#94a3b8]">
					<Loader2 className="w-8 h-8 animate-spin text-[#8b5cf6]" />
					<p className="text-sm">Loading plan…</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto p-4 sm:p-8">
			<div className="mx-auto max-w-3xl flex flex-col gap-5">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-2xl font-bold text-[#f1f5f9]">Training plan</h2>
						<p className="text-sm text-[#94a3b8]">
							The coach's planned workouts, straight from your Training calendar
							{plan?.timezone ? ` (${plan.timezone})` : ""}.
						</p>
					</div>
					<AnimatedButton
						onClick={handleRefresh}
						disabled={refreshing || !plan?.connected}
						className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{refreshing ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<RefreshCw className="w-4 h-4" />
						)}
						{refreshing ? "Refreshing…" : "Refresh now"}
					</AnimatedButton>
				</div>

				{error && (
					<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400">
						<AlertCircle className="w-4 h-4 shrink-0" />
						{error}
					</div>
				)}
				{notice && (
					<div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
						<CheckCircle2 className="w-4 h-4 shrink-0" />
						{notice}
					</div>
				)}

				{!plan?.connected ? (
					<div className="flex flex-col items-center gap-3 text-center py-16">
						<CalendarDays className="w-12 h-12 text-[#8b5cf6]/30" />
						<p className="text-sm text-[#94a3b8] max-w-sm">
							Connect your Training calendar and the coach's planned workouts
							will show up here.
						</p>
						<Link
							to="/settings"
							className="flex items-center gap-1.5 text-xs text-[#c4b5fd] hover:text-[#a78bfa]"
						>
							<Settings2 className="w-3.5 h-3.5" />
							Open settings
						</Link>
					</div>
				) : weeks.length === 0 ? (
					<div className="flex flex-col items-center gap-3 text-center py-16">
						<CalendarDays className="w-12 h-12 text-[#8b5cf6]/30" />
						<p className="text-sm text-[#94a3b8] max-w-sm">
							No planned workouts yet. Ask the coach in Trainer chat, or hit
							Refresh now to generate the week.
						</p>
					</div>
				) : (
					weeks.map((week) => (
						<section
							key={week.key}
							className="rounded-2xl border border-[rgba(139,92,246,0.15)] bg-[#160f2b]/80 p-4 sm:p-5"
						>
							<header className="flex items-baseline justify-between gap-3 mb-2">
								<h3 className="text-sm font-semibold text-[#f1f5f9]">
									Week of {formatDay(week.start)}
								</h3>
								<span className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#7c6fa0]">
									{week.key}
								</span>
							</header>
							<ul>
								{week.workouts.map((w) => (
									<WorkoutRow key={w.id} workout={w} />
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</div>
	);
}
