import { db } from "../../db.js";
import {
	buildPowerBySecond,
	peakPowerFromSeconds,
	type ActivitySummary,
	type StoredRecord,
	type ToolDefinition,
	type ToolResult,
} from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";
import { computeAllTimeEstimates } from "../athleteStats.js";

const DEFAULT_LOOKBACK_DAYS = 42;
const CTL_TC = 42;
const ATL_TC = 7;

const summaryStmt = db.prepare(
	`SELECT date, summary, records FROM activities
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
);

interface DailyTss {
	date: string;
	tss: number | null;
}

function estimateFtp(userId: string): number | null {
	try {
		const { estimatedFtp } = computeAllTimeEstimates(userId, null);
		return estimatedFtp;
	} catch {
		return null;
	}
}

function computeTssForActivity(
	summary: ActivitySummary,
	records: StoredRecord[],
	ftp: number,
): number | null {
	const durationHours = (summary.totalTimerTime ?? 0) / 3600;
	if (durationHours <= 0) return null;

	const intensityFactor =
		summary.normalizedPower != null
			? summary.normalizedPower / ftp
			: summary.avgPower != null
				? summary.avgPower / ftp
				: null;
	if (intensityFactor == null || intensityFactor <= 0) return null;

	if (summary.normalizedPower != null) {
		return Math.round(intensityFactor * intensityFactor * durationHours * 100);
	}

	// Fallback: derive NP from records if the summary didn't store it
	try {
		const mapped = records.map((r) => ({
			timestamp: new Date(r.timestamp),
			elapsedSeconds: r.elapsedSeconds,
			power: r.power,
			heartRate: r.heartRate,
			cadence: r.cadence,
			speed: r.speed,
			gradient: r.gradient,
			lat: r.lat,
			lng: r.lng,
		}));
		const powerBySecond = buildPowerBySecond(mapped);
		let sum = 0;
		let count = 0;
		const window = 30;
		for (let i = 0; i + window <= powerBySecond.length; i++) {
			let windowSum = 0;
			let windowCount = 0;
			for (let j = 0; j < window; j++) {
				const v = powerBySecond[i + j];
				if (v != null && v > 0) {
					windowSum += v;
					windowCount++;
				}
			}
			if (windowCount > 0) {
				const avg = windowSum / windowCount;
				sum += avg ** 4;
				count++;
			}
		}
		if (count === 0) return null;
		const np = (sum / count) ** 0.25;
		const derivedIf = np / ftp;
		return Math.round(derivedIf * derivedIf * durationHours * 100);
	} catch {
		return null;
	}
}

function formatDay(date: Date): string {
	return date.toISOString().split("T")[0];
}

export const trainingLoadDefinition: ToolDefinition = {
	name: "training_load",
	description:
		"Compute Training Stress Score (TSS), Chronic Training Load (CTL/fitness), Acute Training Load (ATL/fatigue), and Training Stress Balance (TSB/form) from recent activities.",
	parameters: {
		type: "object",
		properties: {
			days: {
				type: "number",
				description:
					"Number of days to look back from today (default 42). If unsure of today, call current_time first.",
			},
		},
		required: [],
	},
};

export const trainingLoadHandler: ToolHandler = async (args, context) => {
	const userId = context.userId;
	try {
		const daysRaw =
			typeof args.days === "number" ? args.days : DEFAULT_LOOKBACK_DAYS;
		const days =
			Number.isFinite(daysRaw) && daysRaw > 0
				? Math.min(365, Math.floor(daysRaw))
				: DEFAULT_LOOKBACK_DAYS;

		const ftp = estimateFtp(userId);
		if (ftp == null) {
			return {
				id: "",
				name: "training_load",
				content: "",
				display: null,
				error:
					"Could not estimate FTP — the athlete has no power data yet. Ask them for their FTP before calculating training load.",
			};
		}

		const end = new Date();
		end.setDate(end.getDate() + 1);
		const start = new Date();
		start.setDate(start.getDate() - days);
		const startStr = formatDay(start);
		const endStr = formatDay(end);

		const rows = summaryStmt.all(userId, startStr, endStr) as {
			date: string;
			summary: string;
			records: string;
		}[];

		const byDate = new Map<string, DailyTss>();
		for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
			byDate.set(formatDay(d), { date: formatDay(d), tss: 0 });
		}
		for (const row of rows) {
			let summary: ActivitySummary;
			let records: StoredRecord[] = [];
			try {
				summary = JSON.parse(row.summary) as ActivitySummary;
				records = JSON.parse(row.records) as StoredRecord[];
			} catch {
				continue;
			}
			const tss = computeTssForActivity(summary, records, ftp);
			if (tss == null) continue;
			const existing = byDate.get(row.date);
			if (existing) existing.tss = (existing.tss ?? 0) + tss;
			else byDate.set(row.date, { date: row.date, tss });
		}

		const ordered = Array.from(byDate.values()).sort((a, b) =>
			a.date.localeCompare(b.date),
		);

		const ctlAlpha = 1 - Math.exp(-1 / CTL_TC);
		const atlAlpha = 1 - Math.exp(-1 / ATL_TC);

		let ctl = 0;
		let atl = 0;
		const ctlSeries: number[] = [];
		const atlSeries: number[] = [];
		const tsbSeries: number[] = [];
		for (const d of ordered) {
			const tss = d.tss ?? 0;
			ctl = ctl + ctlAlpha * (tss - ctl);
			atl = atl + atlAlpha * (tss - atl);
			ctlSeries.push(Math.round(ctl * 10) / 10);
			atlSeries.push(Math.round(atl * 10) / 10);
			tsbSeries.push(Math.round((ctl - atl) * 10) / 10);
		}

		const currentCtl = ctlSeries[ctlSeries.length - 1] ?? 0;
		const currentAtl = atlSeries[atlSeries.length - 1] ?? 0;
		const currentTsb = tsbSeries[tsbSeries.length - 1] ?? 0;

		const totalTss = ordered.reduce((sum, d) => sum + (d.tss ?? 0), 0);

		let form: string;
		if (currentTsb > 15) form = "fresh/transitional";
		else if (currentTsb > 0) form = "rested/ready";
		else if (currentTsb > -10) form = "balanced";
		else if (currentTsb > -25) form = "productive fatigue";
		else form = "deep fatigue/risk of overtraining";

		const content = [
			`Estimated FTP: ${ftp} W`,
			`Lookback: last ${days} days (${ordered.length} daily buckets)`,
			`Total TSS: ${Math.round(totalTss)}`,
			`Current CTL (fitness): ${currentCtl}`,
			`Current ATL (fatigue): ${currentAtl}`,
			`Current TSB (form): ${currentTsb} — ${form}`,
		].join("\n");

		return {
			id: "",
			name: "training_load",
			content,
			display: {
				ftp,
				days,
				totalTss: Math.round(totalTss),
				dates: ordered.map((d) => d.date),
				tss: ordered.map((d) => Math.round((d.tss ?? 0) * 10) / 10),
				ctl: ctlSeries,
				atl: atlSeries,
				tsb: tsbSeries,
				current: {
					ctl: currentCtl,
					atl: currentAtl,
					tsb: currentTsb,
					form,
				},
			},
		};
	} catch (error) {
		return {
			id: "",
			name: "training_load",
			content: "",
			display: null,
			error:
				error instanceof Error
					? error.message
					: "Training load analysis failed",
		};
	}
};
