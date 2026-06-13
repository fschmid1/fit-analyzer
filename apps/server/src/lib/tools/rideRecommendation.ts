import { computeAllTimeEstimates } from "../athleteStats.js";
import { db } from "../../db.js";
import type { ActivitySummary, ToolDefinition } from "@fit-analyzer/shared";
import type { ToolHandler } from "./registry.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CTL_TC = 42;
const ATL_TC = 7;

const summaryStmt = db.prepare(
	`SELECT date, summary, records FROM activities
     WHERE user_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC`,
);

interface WeatherResult {
	tempMax: number | null;
	tempMin: number | null;
	precip: number | null;
	windMax: number | null;
}

async function fetchWeather(
	lat: number,
	lng: number,
): Promise<WeatherResult | null> {
	const today = new Date().toISOString().split("T")[0];
	const baseUrl = "https://api.open-meteo.com/v1/forecast";
	const url = new URL(baseUrl);
	url.searchParams.set("latitude", String(lat));
	url.searchParams.set("longitude", String(lng));
	url.searchParams.set("start_date", today);
	url.searchParams.set("end_date", today);
	url.searchParams.set(
		"daily",
		"temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
	);
	url.searchParams.set("timezone", "auto");

	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return null;
		const data = (await response.json()) as {
			daily?: {
				time?: string[];
				temperature_2m_max?: number[];
				temperature_2m_min?: number[];
				precipitation_sum?: number[];
				wind_speed_10m_max?: number[];
			};
		};
		const daily = data.daily;
		if (!daily?.time?.[0]) return null;
		return {
			tempMax: daily.temperature_2m_max?.[0] ?? null,
			tempMin: daily.temperature_2m_min?.[0] ?? null,
			precip: daily.precipitation_sum?.[0] ?? null,
			windMax: daily.wind_speed_10m_max?.[0] ?? null,
		};
	} catch {
		return null;
	}
}

function resolvePhase(eventDate: string | null): string | null {
	if (!eventDate || !DATE_RE.test(eventDate)) return null;
	const target = new Date(`${eventDate}T00:00:00`);
	if (Number.isNaN(target.getTime())) return null;
	const diffDays = Math.round((target.getTime() - Date.now()) / 86400000);
	if (diffDays > 84) return "Base";
	if (diffDays > 56) return "Build";
	if (diffDays > 28) return "Peak";
	if (diffDays > 7) return "Taper";
	return "Race week";
}

interface Recommendation {
	type: string;
	intensity: string;
	duration: number;
	rationale: string;
}

function computeRecommendation(
	tsb: number,
	phase: string | null,
	weather: WeatherResult | null,
	availableMinutes: number,
): Recommendation {
	const badWeather =
		weather != null &&
		((weather.precip != null && weather.precip > 5) ||
			(weather.windMax != null && weather.windMax > 40));

	if (tsb < -25 && badWeather) {
		return {
			type: "Rest day",
			intensity: "Z0",
			duration: 0,
			rationale:
				"TSB is very negative and weather is poor — ideal recovery opportunity.",
		};
	}

	if (tsb < -25) {
		return {
			type: "Recovery ride",
			intensity: "Z1",
			duration: Math.min(availableMinutes, 45),
			rationale:
				"TSB is very negative — prioritise recovery with easy spinning.",
		};
	}

	if (tsb < -10 && badWeather) {
		return {
			type: "Indoor trainer or easy ride",
			intensity: "Z1-Z2",
			duration: Math.min(availableMinutes, 60),
			rationale:
				"Fatigued and weather isn't great — keep it easy or ride indoors.",
		};
	}

	if (tsb < -10) {
		return {
			type: "Endurance ride",
			intensity: "Z2",
			duration: Math.min(availableMinutes, 90),
			rationale: "Moderate fatigue — stick to Zone 2 endurance.",
		};
	}

	if (phase === "Peak" || phase === "Taper") {
		return {
			type: "VO2max or race-pace intervals",
			intensity: "Z5",
			duration: Math.min(availableMinutes, 75),
			rationale: `${phase} phase — sharpen with high-intensity, low-volume work.`,
		};
	}

	if (tsb <= 0 && (phase === "Build" || phase === "Base")) {
		return {
			type: "Sweet spot or threshold intervals",
			intensity: "Z3-Z4",
			duration: Math.min(availableMinutes, 90),
			rationale:
				"Productive fatigue — threshold or sweet spot work is appropriate.",
		};
	}

	if (tsb > 15) {
		return {
			type: "Hard workout or long ride",
			intensity: "Z3-Z5",
			duration: Math.min(availableMinutes, 120),
			rationale: "Well-rested — good day for a demanding session.",
		};
	}

	if (tsb > 0) {
		return {
			type: "VO2max or long endurance",
			intensity: "Z2-Z5",
			duration: Math.min(availableMinutes, 90),
			rationale: "Rested — consider intensity or extended endurance.",
		};
	}

	return {
		type: "Moderate ride",
		intensity: "Z2-Z3",
		duration: Math.min(availableMinutes, 75),
		rationale: "Balanced training stress — a moderate session fits.",
	};
}

export const rideRecommendationDefinition: ToolDefinition = {
	name: "ride_recommendation",
	description:
		"Recommend today's optimal ride based on current training load, weather forecast, and event timeline.",
	parameters: {
		type: "object",
		properties: {
			lat: {
				type: "number",
				description: "Latitude for weather forecast",
			},
			lng: {
				type: "number",
				description: "Longitude for weather forecast",
			},
			availableMinutes: {
				type: "number",
				description: "Available time in minutes (default 60)",
			},
			eventDate: {
				type: "string",
				description: "Target event date for phase context",
			},
		},
		required: [],
	},
};

export const rideRecommendationHandler: ToolHandler = async (args, context) => {
	const userId = context.userId;
	const availableMinutes =
		typeof args.availableMinutes === "number" && args.availableMinutes > 0
			? Math.min(300, Math.floor(args.availableMinutes))
			: 60;

	const ftp = computeAllTimeEstimates(userId, null).estimatedFtp;

	const eventDate =
		typeof args.eventDate === "string" ? args.eventDate.trim() : null;
	const phase = resolvePhase(eventDate);

	const now = new Date();
	const endDate = new Date(now);
	endDate.setDate(endDate.getDate() + 1);
	const startDate = new Date(now);
	startDate.setDate(startDate.getDate() - 42);
	const startStr = startDate.toISOString().split("T")[0];
	const endStr = endDate.toISOString().split("T")[0];

	const rows = summaryStmt.all(userId, startStr, endStr) as {
		date: string;
		summary: string;
		records: string;
	}[];

	interface DailyTss {
		date: string;
		tss: number | null;
	}

	const byDate = new Map<string, DailyTss>();
	for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
		byDate.set(d.toISOString().split("T")[0], {
			date: d.toISOString().split("T")[0],
			tss: 0,
		});
	}

	if (ftp != null) {
		for (const row of rows) {
			let summary: ActivitySummary;
			try {
				summary = JSON.parse(row.summary) as ActivitySummary;
			} catch {
				continue;
			}
			const durationHours = (summary.totalTimerTime ?? 0) / 3600;
			if (durationHours <= 0) continue;
			const if_ =
				summary.normalizedPower != null
					? summary.normalizedPower / ftp
					: summary.avgPower != null
						? summary.avgPower / ftp
						: null;
			if (if_ == null || if_ <= 0) continue;
			const tss = Math.round(if_ * if_ * durationHours * 100);
			const existing = byDate.get(row.date);
			if (existing) existing.tss = (existing.tss ?? 0) + tss;
			else byDate.set(row.date, { date: row.date, tss });
		}
	}

	const ordered = Array.from(byDate.values()).sort((a, b) =>
		a.date.localeCompare(b.date),
	);

	let ctl = 0;
	let atl = 0;
	const ctlAlpha = 1 - Math.exp(-1 / CTL_TC);
	const atlAlpha = 1 - Math.exp(-1 / ATL_TC);

	for (const d of ordered) {
		const tss = d.tss ?? 0;
		ctl = ctl + ctlAlpha * (tss - ctl);
		atl = atl + atlAlpha * (tss - atl);
	}

	const tsb = Math.round((ctl - atl) * 10) / 10;
	ctl = Math.round(ctl * 10) / 10;
	atl = Math.round(atl * 10) / 10;

	let form: string;
	if (tsb > 15) form = "fresh/transitional";
	else if (tsb > 0) form = "rested/ready";
	else if (tsb > -10) form = "balanced";
	else if (tsb > -25) form = "productive fatigue";
	else form = "deep fatigue/risk of overtraining";

	const lat =
		typeof args.lat === "number" && Number.isFinite(args.lat) ? args.lat : null;
	const lng =
		typeof args.lng === "number" && Number.isFinite(args.lng) ? args.lng : null;
	const weather =
		lat != null && lng != null ? await fetchWeather(lat, lng) : null;

	const recommendation = computeRecommendation(
		tsb,
		phase,
		weather,
		availableMinutes,
	);

	const content = [
		`Recommendation: ${recommendation.type}`,
		`Intensity: ${recommendation.intensity}`,
		`Duration: ${recommendation.duration > 0 ? `${recommendation.duration} min` : "Rest"}`,
		`Rationale: ${recommendation.rationale}`,
		"",
		`Training load: CTL ${ctl} \u00b7 ATL ${atl} \u00b7 TSB ${tsb} (${form})`,
		phase ? `Training phase: ${phase}` : null,
		weather
			? `Weather: ${weather.tempMax ?? "?"}\u00B0C / ${weather.tempMin ?? "?"}\u00B0C, precip ${weather.precip ?? "?"}mm, wind ${weather.windMax ?? "?"}km/h`
			: null,
	]
		.filter(Boolean)
		.join("\n");

	return {
		id: "",
		name: "ride_recommendation",
		content,
		display: {
			recommendation: recommendation.type,
			rationale: recommendation.rationale,
			intensity: recommendation.intensity,
			duration: recommendation.duration,
			weather: weather
				? {
						tempMax: weather.tempMax,
						tempMin: weather.tempMin,
						precip: weather.precip,
						windMax: weather.windMax,
					}
				: null,
			trainingLoad: {
				ctl,
				atl,
				tsb,
				form,
			},
			phase,
		},
	};
};
