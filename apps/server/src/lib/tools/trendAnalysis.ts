import { db } from "../../db.js";
import { debug } from "../debug.js";
import type { ActivitySummary, ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

const METRIC_LIST = [
	"avgPower",
	"normalizedPower",
	"peak1minPower",
	"peak5minPower",
	"peak20minPower",
	"avgHeartRate",
	"avgCadence",
	"totalDistanceKm",
	"totalTimerTime",
	"totalWork",
] as const;

type MetricKey = (typeof METRIC_LIST)[number];

const METRIC_LABELS: Record<MetricKey, string> = {
	avgPower: "Average Power",
	normalizedPower: "Normalized Power",
	peak1minPower: "Peak 1-min Power",
	peak5minPower: "Peak 5-min Power",
	peak20minPower: "Peak 20-min Power",
	avgHeartRate: "Average Heart Rate",
	avgCadence: "Average Cadence",
	totalDistanceKm: "Total Distance",
	totalTimerTime: "Total Duration",
	totalWork: "Total Work",
};

const DEFAULT_LOOKBACK_DAYS = 90;

const summaryStmt = db.prepare(
	`SELECT date, summary FROM activities
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
);

function extractMetric(
	summary: ActivitySummary,
	metric: MetricKey,
): number | null {
	const val = summary[metric as keyof ActivitySummary];
	if (typeof val === "number" && Number.isFinite(val)) return val;
	return null;
}

function linearRegression(
	xs: number[],
	ys: number[],
): {
	slope: number;
	intercept: number;
	r2: number;
} {
	const n = xs.length;
	if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
	const sumX = xs.reduce((a, b) => a + b, 0);
	const sumY = ys.reduce((a, b) => a + b, 0);
	const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
	const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
	const sumY2 = ys.reduce((acc, y) => acc + y * y, 0);
	const denom = n * sumX2 - sumX * sumX;
	if (denom === 0) return { slope: 0, intercept: 0, r2: 0 };
	const slope = (n * sumXY - sumX * sumY) / denom;
	const intercept = (sumY - slope * sumX) / n;
	const yMean = sumY / n;
	const ssTot = sumY2 - n * yMean * yMean;
	const ssRes = ys.reduce((acc, y, i) => {
		const pred = slope * xs[i] + intercept;
		return acc + (y - pred) ** 2;
	}, 0);
	const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
	return { slope, intercept, r2 };
}

function rollingAverage(values: number[], window: number): number[] {
	if (values.length === 0) return [];
	const result: number[] = [];
	for (let i = 0; i < values.length; i++) {
		const start = Math.max(0, i - window + 1);
		const slice = values.slice(start, i + 1);
		result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
	}
	return result;
}

export const trendAnalysisDefinition: ToolDefinition = {
	name: "trend_analysis",
	description:
		"Analyze trends in a specific performance metric over time. Returns a time series with trend direction, rate of change, and statistical significance.",
	parameters: {
		type: "object",
		properties: {
			metric: {
				type: "string",
				enum: [...METRIC_LIST],
				description: "Metric to analyze",
			},
			days: {
				type: "number",
				description: "Number of days to look back (default 90)",
			},
			activityId: {
				type: "string",
				description: "Optional: compare against a specific activity",
			},
		},
		required: ["metric"],
	},
};

export const trendAnalysisHandler: ToolHandler = async (args, context) => {
	const userId = context.userId;
	const end = debug.time("tool", "trend_analysis");
	try {
		const metricRaw = typeof args.metric === "string" ? args.metric : "";
		if (!METRIC_LIST.includes(metricRaw as MetricKey)) {
			return {
				id: "",
				name: "trend_analysis",
				content: "",
				display: null,
				error: `Invalid metric. Must be one of: ${METRIC_LIST.join(", ")}`,
			};
		}
		const metric = metricRaw as MetricKey;

		const daysRaw =
			typeof args.days === "number" ? args.days : DEFAULT_LOOKBACK_DAYS;
		const days =
			Number.isFinite(daysRaw) && daysRaw > 0
				? Math.min(365, Math.floor(daysRaw))
				: DEFAULT_LOOKBACK_DAYS;

		const now = new Date();
		const endDay = new Date(now);
		endDay.setDate(endDay.getDate() + 1);
		const startDay = new Date(now);
		startDay.setDate(startDay.getDate() - days);

		const formatDay = (d: Date) => d.toISOString().split("T")[0];
		const startStr = formatDay(startDay);
		const endStr = formatDay(endDay);

		const rows = summaryStmt.all(userId, startStr, endStr) as {
			date: string;
			summary: string;
		}[];

		const dates: string[] = [];
		const values: number[] = [];

		for (const row of rows) {
			let summary: ActivitySummary;
			try {
				summary = JSON.parse(row.summary) as ActivitySummary;
			} catch {
				continue;
			}
			const val = extractMetric(summary, metric);
			if (val != null) {
				dates.push(row.date);
				values.push(val);
			}
		}

		if (values.length < 2) {
			return {
				id: "",
				name: "trend_analysis",
				content: `Not enough data points for ${METRIC_LABELS[metric]} in the last ${days} days. Found ${values.length} data point(s).`,
				display: null,
				error:
					values.length === 0
						? `No data found for ${METRIC_LABELS[metric]} in the last ${days} days.`
						: `Only 1 data point found for ${METRIC_LABELS[metric]}. Need at least 2 for trend analysis.`,
			};
		}

		const dayOffsets = dates.map((d) => {
			const diff = new Date(d).getTime() - new Date(dates[0]).getTime();
			return diff / 86400000;
		});

		const { slope, r2, intercept } = linearRegression(dayOffsets, values);

		const changePerWeek = slope * 7;

		let direction: string;
		const isHigherBetter = !["avgHeartRate", "totalTimerTime"].includes(metric);
		if (Math.abs(r2) < 0.05) {
			direction = "stable";
		} else if (changePerWeek > 0) {
			direction = isHigherBetter ? "improving" : "declining";
		} else {
			direction = isHigherBetter ? "declining" : "improving";
		}

		const avg = rollingAverage(values, Math.min(7, values.length));

		const current = values[values.length - 1];
		const minVal = Math.min(...values);
		const maxVal = Math.max(...values);

		const label = METRIC_LABELS[metric];
		const unit =
			metric === "avgHeartRate" || metric === "avgCadence"
				? ""
				: metric === "totalDistanceKm"
					? " km"
					: metric === "totalTimerTime"
						? " s"
						: metric === "totalWork"
							? " kJ"
							: " W";

		const content = [
			`${label} trend (last ${days} days, ${values.length} activities):`,
			`- Current: ${current.toFixed(1)}${unit}`,
			`- Range: ${minVal.toFixed(1)}${unit} – ${maxVal.toFixed(1)}${unit}`,
			`- Trend: ${direction} (${changePerWeek > 0 ? "+" : ""}${changePerWeek.toFixed(2)}${unit}/week)`,
			`- R² = ${r2.toFixed(3)}`,
		].join("\n");

		return {
			id: "",
			name: "trend_analysis",
			content,
			display: {
				metric: label,
				dates,
				values,
				rollingAvg: avg,
				trend: {
					slope,
					direction,
					r2,
					changePerWeek,
				},
			},
		};
	} finally {
		end();
	}
};
