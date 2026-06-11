import type { HeatmapResponse, RecentNight } from "@fit-analyzer/shared";
import {
	Activity,
	AlertCircle,
	BarChart3,
	Bed,
	Brain,
	Clock,
	Droplets,
	Flame,
	Gauge,
	Heart,
	Loader2,
	Moon,
	MoonStar,
	RefreshCw,
	Route,
	Smartphone,
	Thermometer,
	TrendingUp,
	Watch,
	Wind,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AnimatedButton } from "../components/AnimatedButton";
import { HealthMonitorCard } from "../components/HealthMonitorCard";
import { HeatmapMap } from "../components/HeatmapMap";
import { MetricCard } from "../components/MetricCard";
import { TimelineItem } from "../components/TimelineItem";
import { fetchHeatmap, fetchStats, type StatsResponse } from "../lib/api";

type Preset = "7d" | "30d" | "90d" | "year" | "custom";

function dateFromDaysBack(daysBack: number): string {
	const d = new Date();
	d.setDate(d.getDate() - daysBack);
	return d.toISOString().split("T")[0];
}

function todayStr(): string {
	return new Date().toISOString().split("T")[0];
}

function startOfYear(): string {
	return `${new Date().getFullYear()}-01-01`;
}

function presetRange(preset: Preset): { startDate: string; endDate: string } {
	switch (preset) {
		case "7d":
			return { startDate: dateFromDaysBack(7), endDate: todayStr() };
		case "30d":
			return { startDate: dateFromDaysBack(30), endDate: todayStr() };
		case "90d":
			return { startDate: dateFromDaysBack(90), endDate: todayStr() };
		case "year":
			return { startDate: startOfYear(), endDate: todayStr() };
		case "custom":
			return { startDate: "", endDate: "" };
	}
}

function formatGermanDate(dateStr: string): string {
	const [y, m, d] = dateStr.split("-");
	return `${d}.${m}.${y.slice(2)}`;
}

function sleepSubtitle(night: RecentNight): string {
	const parts: string[] = [];
	if (night.stages) {
		const restorative = night.stages.deepMinutes + night.stages.remMinutes;
		parts.push(`${restorative}m restorative`);
	}
	if (night.efficiencyPercent != null) {
		parts.push(`${night.efficiencyPercent.toFixed(0)}% efficiency`);
	}
	return parts.join(" · ") || night.quality || "";
}

export function StatsPage() {
	const [preset, setPreset] = useState<Preset>("30d");
	const [startDate, setStartDate] = useState(() => dateFromDaysBack(30));
	const [endDate, setEndDate] = useState(() => todayStr());
	const [data, setData] = useState<StatsResponse | null>(null);
	const [heatmapData, setHeatmapData] = useState<HeatmapResponse | null>(null);
	const [heatmapLoading, setHeatmapLoading] = useState(true);
	const [heatmapError, setHeatmapError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async (sd: string, ed: string) => {
		setLoading(true);
		setError(null);
		setHeatmapLoading(true);
		setHeatmapError(null);
		try {
			const statsResult = await fetchStats(sd, ed);
			setData(statsResult);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load stats");
			setData(null);
		} finally {
			setLoading(false);
		}
		try {
			const hdata = await fetchHeatmap(sd, ed);
			setHeatmapData(hdata);
			setHeatmapError(null);
		} catch {
			setHeatmapError("Failed to load heatmap data");
			setHeatmapData(null);
		} finally {
			setHeatmapLoading(false);
		}
	}, []);

	useEffect(() => {
		if (preset !== "custom") {
			const r = presetRange(preset);
			setStartDate(r.startDate);
			setEndDate(r.endDate);
			load(r.startDate, r.endDate);
		}
	}, [preset, load]);

	const handlePreset = (p: Preset) => {
		setPreset(p);
	};

	const handleCustomApply = () => {
		if (startDate && endDate) {
			load(startDate, endDate);
		}
	};

	const presets: { key: Preset; label: string }[] = [
		{ key: "7d", label: "7 days" },
		{ key: "30d", label: "30 days" },
		{ key: "90d", label: "90 days" },
		{ key: "year", label: "This Year" },
		{ key: "custom", label: "Custom" },
	];

	return (
		<div className="flex-1 overflow-y-auto p-6 animate-[fadeIn_0.4s_ease-out]">
			<div className="max-w-7xl xl:max-w-none">
				<h2 className="text-2xl font-bold text-[#f1f5f9] mb-1">Stats</h2>
				<p className="text-sm text-[#94a3b8] mb-6">
					Health data and activity statistics
				</p>

				{loading && (
					<div className="flex items-center gap-3 text-[#94a3b8] py-12">
						<Loader2 className="w-5 h-5 animate-spin" />
						<span>Loading stats...</span>
					</div>
				)}

				{error && (
					<div className="flex items-center gap-3 p-4 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-2xl text-[#fca5a5]">
						<AlertCircle className="w-5 h-5 shrink-0" />
						<div>
							<p className="text-sm font-medium">{error}</p>
							<AnimatedButton
								onClick={() => load(startDate, endDate)}
								className="text-xs text-[#94a3b8] hover:text-[#f1f5f9] mt-1 cursor-pointer"
							>
								Retry
							</AnimatedButton>
						</div>
					</div>
				)}

				{!loading && !error && data && (
					<>
						{data.activityStats.count === 0 && !data.health && (
							<div className="flex flex-col items-center gap-3 py-16 text-[#94a3b8]">
								<BarChart3 className="w-12 h-12 opacity-30" />
								<p className="text-sm">No data for this period.</p>
							</div>
						)}

						{/* Health Monitor */}
						{data.health && (
							<section className="mb-8">
								<div className="flex items-center gap-3 mb-4">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
										Health Monitor
									</h3>
									{data.sourceUsed && (
										<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] text-[#94a3b8]">
											{data.sourceUsed === "health_auto_export" ? (
												<>
													<Smartphone className="w-3 h-3 text-emerald-400" />
													<span className="text-[10px] font-medium text-emerald-400">
														HAE
													</span>
												</>
											) : (
												<>
													<Watch className="w-3 h-3 text-[#8b5cf6]" />
													<span className="text-[10px] font-medium text-[#8b5cf6]">
														OW
													</span>
												</>
											)}
											{data.lastSyncAt && (
												<span className="text-[10px] text-[#64748b]">
													· {new Date(data.lastSyncAt).toLocaleString()}
												</span>
											)}
										</div>
									)}
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									<HealthMonitorCard
										icon={Wind}
										label="RR"
										value={data.health.respiratoryRate?.current ?? "—"}
										unit={
											data.health.respiratoryRate?.current != null ? "rpm" : ""
										}
										status={data.health.respiratoryRate?.status ?? "normal"}
										gaugeType="respiratoryRate"
										gaugeValue={data.health.respiratoryRate?.current ?? null}
									/>
									<HealthMonitorCard
										icon={Heart}
										label="RHR"
										value={data.health.rhr?.current ?? "—"}
										unit={data.health.rhr?.current != null ? "bpm" : ""}
										status={data.health.rhr?.status ?? "normal"}
									/>
									<HealthMonitorCard
										icon={Activity}
										label="HRV"
										value={data.health.hrv?.current ?? "—"}
										unit={data.health.hrv?.current != null ? "ms" : ""}
										status={data.health.hrv?.status ?? "normal"}
									/>
									<HealthMonitorCard
										icon={Droplets}
										label="SpO2"
										value={data.health.spo2?.current ?? "—"}
										unit={data.health.spo2?.current != null ? "%" : ""}
										status={data.health.spo2?.status ?? "normal"}
										gaugeType="spo2"
										gaugeValue={data.health.spo2?.current ?? null}
									/>
									<HealthMonitorCard
										icon={Thermometer}
										label="Temp"
										value={data.health.temperature?.current ?? "—"}
										unit={data.health.temperature?.current != null ? "°C" : ""}
										status={data.health.temperature?.status ?? "normal"}
										gaugeType="temperature"
										gaugeValue={data.health.temperature?.current ?? null}
									/>
									<HealthMonitorCard
										icon={Moon}
										label="Sleep"
										value={
											data.health.sleep?.recentNights[0]?.durationFormatted ??
											"—"
										}
										unit=""
										status="normal"
									/>
								</div>
							</section>
						)}

						{/* Timeline */}
						{(() => {
							const recentNights = data.health?.sleep?.recentNights;
							if (!recentNights || recentNights.length === 0) return null;
							return (
								<section className="mb-8">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-4">
										Timeline
									</h3>
									<div className="flex flex-col gap-2">
										{recentNights.slice(0, 5).map((night) => (
											<TimelineItem
												key={night.date}
												icon={MoonStar}
												title="Primary Sleep"
												subtitle={`${formatGermanDate(night.date)} · ${sleepSubtitle(night)}`}
												badge={
													night.efficiencyPercent != null
														? `${night.efficiencyPercent.toFixed(0)}`
														: undefined
												}
												badgeColor="#8b5cf6"
											/>
										))}
									</div>
								</section>
							);
						})()}

						{/* Activity Stats */}
						{data.activityStats.count > 0 && (
							<section className="mb-8">
								<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-1">
									Activities
								</h3>
								<div className="flex flex-wrap items-center gap-2 mb-2">
									{presets.map((p) => (
										<AnimatedButton
											key={p.key}
											onClick={() => handlePreset(p.key)}
											className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer ${
												preset === p.key
													? "bg-[#8b5cf6]/20 text-[#c4b5fd] border border-[#8b5cf6]/30"
													: "bg-[#1a1533]/70 text-[#94a3b8] border border-[rgba(139,92,246,0.1)] hover:text-[#f1f5f9] hover:border-[rgba(139,92,246,0.25)]"
											}`}
										>
											{p.label}
										</AnimatedButton>
									))}
								</div>

								{preset === "custom" && (
									<div className="flex flex-wrap items-end gap-3 mb-4 p-4 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.1)] rounded-2xl">
										<label className="flex flex-col gap-1.5">
											<span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
												Start
											</span>
											<input
												type="date"
												value={startDate}
												onChange={(e) => setStartDate(e.target.value)}
												className="px-3 py-1.5 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded-lg text-[#f1f5f9] focus:outline-none focus:border-[#8b5cf6]/50"
											/>
										</label>
										<label className="flex flex-col gap-1.5">
											<span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider">
												End
											</span>
											<input
												type="date"
												value={endDate}
												onChange={(e) => setEndDate(e.target.value)}
												className="px-3 py-1.5 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded-lg text-[#f1f5f9] focus:outline-none focus:border-[#8b5cf6]/50"
											/>
										</label>
										<AnimatedButton
											onClick={handleCustomApply}
											disabled={!startDate || !endDate}
											className="px-4 py-1.5 text-sm font-medium bg-[#8b5cf6]/20 text-[#c4b5fd] border border-[#8b5cf6]/30 rounded-lg hover:bg-[#8b5cf6]/30 transition-colors duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
										>
											Apply
										</AnimatedButton>
									</div>
								)}

								<p className="text-xs text-[#64748b] mb-4">
									{data.activityStats.count} ride
									{data.activityStats.count !== 1 ? "s" : ""}
								</p>

								<div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
									<MetricCard
										icon={Clock}
										label="Total Duration"
										value={data.activityStats.totalDurationFormatted}
										unit=""
										color="#a78bfa"
									/>
									<MetricCard
										icon={Route}
										label="Total Distance"
										value={
											data.activityStats.totalDistanceKm != null
												? data.activityStats.totalDistanceKm
												: "N/A"
										}
										unit={
											data.activityStats.totalDistanceKm != null ? "km" : ""
										}
										color="#22c55e"
									/>
									<MetricCard
										icon={Zap}
										label="Avg Power"
										value={data.activityStats.avgPower ?? "N/A"}
										unit={data.activityStats.avgPower != null ? "W" : ""}
										subValue={
											data.activityStats.maxPower != null
												? `Max: ${data.activityStats.maxPower} W`
												: undefined
										}
										color="#8b5cf6"
									/>
									<MetricCard
										icon={Zap}
										label="Normalized Power"
										value={data.activityStats.normalizedPower ?? "N/A"}
										unit={data.activityStats.normalizedPower != null ? "W" : ""}
										color="#a855f7"
									/>
									<MetricCard
										icon={Heart}
										label="Avg Heart Rate"
										value={data.activityStats.avgHeartRate ?? "N/A"}
										unit={data.activityStats.avgHeartRate != null ? "bpm" : ""}
										subValue={
											data.activityStats.maxHeartRate != null
												? `Max: ${data.activityStats.maxHeartRate} bpm`
												: undefined
										}
										color="#ef4444"
									/>
									<MetricCard
										icon={Gauge}
										label="Avg Cadence"
										value={data.activityStats.avgCadence ?? "N/A"}
										unit={data.activityStats.avgCadence != null ? "rpm" : ""}
										color="#06b6d4"
									/>
									<MetricCard
										icon={Gauge}
										label="Normalized Cadence"
										value={data.activityStats.normalizedCadence ?? "N/A"}
										unit={
											data.activityStats.normalizedCadence != null ? "rpm" : ""
										}
										color="#06b6d4"
									/>
									<MetricCard
										icon={TrendingUp}
										label="Peak 1min Power"
										value={
											data.activityStats.peak1minPower != null
												? data.activityStats.peak1minPower
												: "N/A"
										}
										unit={data.activityStats.peak1minPower != null ? "W" : ""}
										color="#f59e0b"
									/>
									<MetricCard
										icon={TrendingUp}
										label="Peak 5min Power"
										value={
											data.activityStats.peak5minPower != null
												? data.activityStats.peak5minPower
												: "N/A"
										}
										unit={data.activityStats.peak5minPower != null ? "W" : ""}
										color="#f97316"
									/>
									<MetricCard
										icon={Flame}
										label="Total Work"
										value={
											data.activityStats.totalWork != null
												? Math.round(data.activityStats.totalWork / 1000)
												: "N/A"
										}
										unit={data.activityStats.totalWork != null ? "kJ" : ""}
										color="#ec4899"
									/>
								</div>
							</section>
						)}

						{heatmapLoading && (
							<div className="flex items-center gap-3 text-[#94a3b8] py-4">
								<Loader2 className="w-4 h-4 animate-spin" />
								<span className="text-sm">Loading heatmap...</span>
							</div>
						)}

						{heatmapError && (
							<div className="flex items-center gap-3 p-4 bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-2xl text-[#fcd34d] mb-4">
								<AlertCircle className="w-5 h-5 shrink-0" />
								<p className="text-sm font-medium">{heatmapError}</p>
							</div>
						)}
					</>
				)}
			</div>

			{!loading &&
				!error &&
				!heatmapLoading &&
				!heatmapError &&
				heatmapData &&
				heatmapData.points.length > 0 && (
					<div className="-mx-6 mb-6 mt-4">
						<div className="px-6 mb-4">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
								Heatmap
							</h3>
						</div>
						<HeatmapMap points={heatmapData.points} />
					</div>
				)}
		</div>
	);
}
