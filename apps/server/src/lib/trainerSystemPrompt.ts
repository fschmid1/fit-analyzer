import { db } from "../db.js";
import type { ActivityStats, HealthContext } from "@fit-analyzer/shared";
import { getAthleteProfile } from "./athleteProfile.js";
import {
	computeActivityStats,
	computeAllTimeEstimates,
} from "./athleteStats.js";
import { getActivityById } from "./tools/activityUtils.js";
import { getHaeHealthContext } from "./haeClient.js";
import {
	getOwBodySummary,
	getOwUserId,
	getRawHealthContext,
} from "./owClient.js";

const TRAINER_HEALTH_LOOKBACK_DAYS = 90;

function formatSleepDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `${h}h ${String(m).padStart(2, "0")}m`;
}

function formatHealthContext(ctx: HealthContext, sourceLabel: string): string {
	const parts: string[] = [];
	parts.push(
		`*Health data retrieved ${new Date().toISOString().split("T")[0]} from ${sourceLabel} — this is live, up-to-date data.*`,
	);

	if (ctx.rhr?.current != null) {
		let rhrLine = `- Resting Heart Rate: ${ctx.rhr.current} bpm`;
		if (ctx.rhr.trend7d != null) {
			rhrLine += ` (7-day avg: ${ctx.rhr.trend7d} bpm)`;
			if (ctx.rhr.status === "elevated") {
				rhrLine +=
					" ⚠ Elevated — may indicate fatigue, illness, or incomplete recovery.";
			}
		}
		parts.push(rhrLine);
	}

	if (ctx.morningHeartRate?.current != null) {
		let mhrLine = `- Morning Heart Rate: ${ctx.morningHeartRate.current} bpm`;
		if (ctx.morningHeartRate.trend7d != null) {
			mhrLine += ` (7-day avg: ${ctx.morningHeartRate.trend7d} bpm)`;
			if (ctx.morningHeartRate.status === "elevated") {
				mhrLine +=
					" ⚠ Elevated — may indicate fatigue, illness, or incomplete recovery.";
			}
		}
		parts.push(mhrLine);
	}

	if (ctx.hrv?.current != null) {
		let hrvLine = `- HRV: ${ctx.hrv.current} ms`;
		if (ctx.hrv.trend7d != null) {
			hrvLine += ` (7-day avg: ${ctx.hrv.trend7d} ms)`;
			if (ctx.hrv.status === "lower") {
				hrvLine +=
					" ⚠ Declining — may indicate accumulated stress or overtraining.";
			}
		}
		parts.push(hrvLine);
	}

	if (ctx.respiratoryRate?.current != null) {
		let rrLine = `- Respiratory Rate: ${ctx.respiratoryRate.current} rpm`;
		if (ctx.respiratoryRate.trend7d != null) {
			rrLine += ` (7-day avg: ${ctx.respiratoryRate.trend7d} rpm)`;
		}
		parts.push(rrLine);
	}

	if (ctx.spo2?.current != null) {
		let spo2Line = `- SpO2: ${ctx.spo2.current}%`;
		if (ctx.spo2.trend7d != null) {
			spo2Line += ` (7-day avg: ${ctx.spo2.trend7d}%)`;
		}
		parts.push(spo2Line);
	}

	if (ctx.temperature?.current != null) {
		parts.push(
			`- Body Temperature: ${ctx.temperature.current}°C (${ctx.temperature.status})`,
		);
	}

	if (ctx.sleep) {
		if (ctx.sleep.avgDurationMinutes7d != null) {
			parts.push(
				`- Average Sleep (7 days): ${formatSleepDuration(ctx.sleep.avgDurationMinutes7d)}`,
			);
		}
		if (ctx.sleep.avgEfficiencyPercent7d != null) {
			parts.push(
				`- Average Sleep Efficiency (7 days): ${ctx.sleep.avgEfficiencyPercent7d}%`,
			);
		}
		if (ctx.sleep.avgStages7d) {
			const s = ctx.sleep.avgStages7d;
			parts.push(
				`- Avg Sleep Stages (7d): Awake ${s.awakeMinutes}m, Light ${s.lightMinutes}m, Deep ${s.deepMinutes}m, REM ${s.remMinutes}m`,
			);
		}
		if (ctx.sleep.recentNights.length > 0) {
			const last = ctx.sleep.recentNights[0];
			if (last.durationMinutes > 0) {
				let lastNight = `- Last Night's Sleep (${last.date}): ${formatSleepDuration(last.durationMinutes)}`;
				if (last.quality) {
					lastNight += `, Quality: ${last.quality}`;
				}
				if (last.stages) {
					lastNight += `, Stages: Awake ${last.stages.awakeMinutes}m, Light ${last.stages.lightMinutes}m, Deep ${last.stages.deepMinutes}m, REM ${last.stages.remMinutes}m`;
				}
				parts.push(lastNight);
			}
		}
	}

	if (parts.length <= 1) return "";

	return `\n## Athlete Health Data\nUse this data to contextualize training advice (fatigue, recovery, sleep). This data is fetched live from the athlete's wearables via ${sourceLabel}.\n${parts.join("\n")}\n`;
}

function formatBodyComposition(
	body: Awaited<ReturnType<typeof getOwBodySummary>>,
): string {
	if (!body) return "";
	const parts: string[] = [];
	if (body.age != null) parts.push(`- Age: ${body.age}`);
	if (body.heightCm != null)
		parts.push(`- Height: ${body.heightCm.toFixed(1)} cm`);
	if (body.weightKg != null)
		parts.push(`- Weight: ${body.weightKg.toFixed(1)} kg`);
	if (body.bodyFatPercent != null)
		parts.push(`- Body Fat: ${body.bodyFatPercent.toFixed(1)}%`);
	if (body.muscleMassKg != null)
		parts.push(`- Muscle Mass: ${body.muscleMassKg.toFixed(1)} kg`);
	if (body.bmi != null) parts.push(`- BMI: ${body.bmi.toFixed(1)}`);
	if (body.bloodPressure)
		parts.push(
			`- Blood Pressure: ${body.bloodPressure.systolic}/${body.bloodPressure.diastolic} mmHg`,
		);

	if (parts.length === 0) return "";

	const source = body.source.device
		? `${body.source.provider} (${body.source.device})`
		: body.source.provider;
	return `\n## Athlete Body Composition\nUse these baseline metrics when discussing training load, weight management, or aerobic capacity. Sourced from ${source}.\n${parts.join("\n")}\n`;
}

function formatAthleteProfile(
	profile: Awaited<ReturnType<typeof getAthleteProfile>>,
): string {
	const parts: string[] = [];

	if (profile.ftp != null)
		parts.push(`- FTP: ${profile.ftp} W (user-provided)`);
	if (profile.maxHr != null) parts.push(`- Max HR: ${profile.maxHr} bpm`);
	if (profile.goalEventName || profile.goalEventDate) {
		const event = profile.goalEventName ?? "Goal event";
		const date = profile.goalEventDate ?? "no date set";
		parts.push(`- Goal Event: ${event} on ${date}`);
	}
	if (profile.goalDescription) parts.push(`- Goal: ${profile.goalDescription}`);
	if (profile.weeklyHours != null)
		parts.push(`- Available: ${profile.weeklyHours} hours/week`);
	if (profile.focusAreas.length > 0)
		parts.push(`- Focus: ${profile.focusAreas.join(", ")}`);

	if (parts.length === 0) return "";

	return `\n## Athlete Profile\nUser-provided settings that override estimated values. Always prefer these values over estimates when they exist.\n${parts.join("\n")}\n`;
}

function formatTrainingHistory(
	stats: ActivityStats,
	estimatedFtp: number | null,
	estimatedVo2max: number | null,
): string {
	const parts: string[] = [];
	parts.push(
		`*Aggregated training data computed from ${stats.count} activities over the last ${TRAINER_HEALTH_LOOKBACK_DAYS} days.*`,
	);
	parts.push(
		`- Total Duration: ${stats.totalDurationFormatted} (${stats.totalDurationSeconds}s)`,
	);
	if (stats.totalDistanceKm != null)
		parts.push(`- Total Distance: ${stats.totalDistanceKm} km`);
	if (stats.avgPower != null)
		parts.push(`- Average Power: ${stats.avgPower} W`);
	if (stats.normalizedPower != null)
		parts.push(`- Normalized Power (avg): ${stats.normalizedPower} W`);
	if (stats.maxPower != null) parts.push(`- Max Power: ${stats.maxPower} W`);
	if (stats.peak1minPower != null)
		parts.push(`- Peak 1-min Power: ${stats.peak1minPower} W`);
	if (stats.peak5minPower != null)
		parts.push(`- Peak 5-min Power: ${stats.peak5minPower} W`);
	if (stats.avgHeartRate != null)
		parts.push(`- Average Heart Rate: ${stats.avgHeartRate} bpm`);
	if (stats.maxHeartRate != null)
		parts.push(`- Max Heart Rate (recorded): ${stats.maxHeartRate} bpm`);
	if (stats.avgCadence != null)
		parts.push(`- Average Cadence: ${stats.avgCadence} rpm`);
	if (stats.totalWork != null)
		parts.push(`- Total Work: ${stats.totalWork} kJ`);

	const estimates: string[] = [];
	if (estimatedFtp != null)
		estimates.push(
			`- Estimated FTP: ${estimatedFtp} W (best 20-min peak × 0.95)`,
		);
	if (estimatedVo2max != null)
		estimates.push(`- Estimated VO₂max: ${estimatedVo2max} ml/kg/min`);

	const header =
		"\n## Recent Training History\nUse this to gauge training load, fitness baseline, and intensity distribution.\n";
	if (estimates.length > 0) {
		return `${header}${parts.join("\n")}\n\n### Fitness Estimates\n${estimates.join("\n")}\n`;
	}
	return `${header}${parts.join("\n")}\n`;
}

const getHealthSourceStmt = db.prepare<{ health_source: string }, [string]>(
	"SELECT health_source FROM user_settings WHERE user_id = ?",
);

type HealthSourceResolved = {
	context: HealthContext | null;
	sourceLabel: string;
};

/**
 * Resolve the active health context using the user's configured health source
 * (OpenWearables, Health Auto Export, or auto with fallback). Mirrors the
 * resolution logic in /api/health.
 */
async function resolveActiveHealthContext(
	userId: string,
): Promise<HealthSourceResolved> {
	const row = getHealthSourceStmt.get(userId);
	const healthSource = row?.health_source ?? "openwearables";

	const tryHae = async (): Promise<HealthContext | null> => {
		try {
			return await getHaeHealthContext(userId);
		} catch (err) {
			console.warn("[trainer] HAE health context fetch failed:", err);
			return null;
		}
	};
	const tryOw = async () => {
		try {
			return await getRawHealthContext(userId);
		} catch (err) {
			console.warn("[trainer] OW health context fetch failed:", err);
			return null;
		}
	};

	if (healthSource === "health_auto_export") {
		const ctx = await tryHae();
		if (ctx) return { context: ctx, sourceLabel: "Health Auto Export" };
		const ow = await tryOw();
		if (ow) return { context: ow, sourceLabel: "OpenWearables" };
		return { context: null, sourceLabel: "OpenWearables" };
	}
	if (healthSource === "auto") {
		const haeCtx = await tryHae();
		if (haeCtx) return { context: haeCtx, sourceLabel: "Health Auto Export" };
		const owCtx = await tryOw();
		if (owCtx) return { context: owCtx, sourceLabel: "OpenWearables" };
		return { context: null, sourceLabel: "OpenWearables" };
	}
	// openwearables (default)
	const ow = await tryOw();
	if (ow) return { context: ow, sourceLabel: "OpenWearables" };
	return { context: null, sourceLabel: "OpenWearables" };
}

function getLookbackDateRange(): { startDate: string; endDate: string } {
	const end = new Date();
	end.setDate(end.getDate() + 1);
	const start = new Date();
	start.setDate(start.getDate() - TRAINER_HEALTH_LOOKBACK_DAYS);
	const fmt = (d: Date) => d.toISOString().split("T")[0];
	return { startDate: fmt(start), endDate: fmt(end) };
}

/**
 * Build the dynamic, user-specific portion of the trainer system prompt.
 * Returns an empty string when no data could be loaded (the caller decides
 * whether to inject anything).
 */
export async function buildTrainerAthleteContext(
	userId: string,
): Promise<string> {
	const { context, sourceLabel } = await resolveActiveHealthContext(userId);

	const { startDate, endDate } = getLookbackDateRange();
	const activityStats = computeActivityStats(userId, startDate, endDate);
	const { estimatedFtp, estimatedVo2max } = computeAllTimeEstimates(
		userId,
		context,
	);

	const profile = getAthleteProfile(userId);

	const sections: string[] = [];

	const profileText = formatAthleteProfile(profile);
	if (profileText) sections.push(profileText);

	if (context) {
		sections.push(formatHealthContext(context, sourceLabel));
	}

	// Body composition is OW-only today; only attempt when an OW link exists.
	if (getOwUserId(userId)) {
		try {
			const body = await getOwBodySummary(userId);
			const bodyText = formatBodyComposition(body);
			if (bodyText) sections.push(bodyText);
		} catch (err) {
			console.warn("[trainer] OW body summary fetch failed:", err);
		}
	}

	if (activityStats.count > 0) {
		sections.push(
			formatTrainingHistory(activityStats, estimatedFtp, estimatedVo2max),
		);
	} else if (estimatedFtp != null || estimatedVo2max != null) {
		// No recent training history, but we can still share lifetime estimates
		const estimates: string[] = [];
		if (estimatedFtp != null)
			estimates.push(`- Estimated FTP: ${estimatedFtp} W`);
		if (estimatedVo2max != null)
			estimates.push(`- Estimated VO₂max: ${estimatedVo2max} ml/kg/min`);
		if (estimates.length > 0) {
			sections.push(
				`\n## Fitness Estimates\nComputed from the athlete's full training history.\n${estimates.join("\n")}\n`,
			);
		}
	}

	return sections.join("\n");
}

export function formatCurrentActivity(
	activityId: string,
	userId: string,
): string {
	const data = getActivityById(activityId, userId);
	if (!data) return "";

	const s = data.summary;
	const lines: string[] = [];
	lines.push(`Date: ${data.date}`);
	lines.push(
		`Duration: ${Math.round((s.totalTimerTime ?? 0) / 60)} min, Distance: ${
			s.totalDistanceKm != null ? `${s.totalDistanceKm} km` : "n/a"
		}`,
	);
	if (s.avgPower != null) lines.push(`Avg Power: ${s.avgPower} W`);
	if (s.normalizedPower != null) lines.push(`NP: ${s.normalizedPower} W`);
	if (s.maxPower != null) lines.push(`Max Power: ${s.maxPower} W`);
	if (s.avgHeartRate != null) lines.push(`Avg HR: ${s.avgHeartRate} bpm`);
	if (s.maxHeartRate != null) lines.push(`Max HR: ${s.maxHeartRate} bpm`);

	const peaks = data.peakPowers;
	const peakLines: string[] = [];
	if (peaks.peak1min != null) peakLines.push(`1min: ${peaks.peak1min} W`);
	if (peaks.peak5min != null) peakLines.push(`5min: ${peaks.peak5min} W`);
	if (peaks.peak20min != null) peakLines.push(`20min: ${peaks.peak20min} W`);
	if (peakLines.length > 0) {
		lines.push(`Peak Powers: ${peakLines.join(", ")}`);
	}

	if (data.intervals.length > 0) {
		lines.push(
			`Intervals: ${data.intervals.length} detected (${data.intervals.map((i) => `${Math.round(i.avgPower ?? 0)}W`).join("–")})`,
		);
	}

	return `\n## Current Activity\nThe athlete is currently viewing this activity. Use the activity_lookup tool for full details.\n${lines.join("\n")}\n`;
}
