import type { ToolDefinition, ToolResult } from "@fit-analyzer/shared";
import { debug } from "../debug.js";
import type { ToolHandler } from "./registry.js";

interface OpenMeteoDaily {
	time?: string[];
	temperature_2m_max?: number[];
	temperature_2m_min?: number[];
	precipitation_sum?: number[];
	wind_speed_10m_max?: number[];
	wind_direction_10m_dominant?: number[];
}

interface OpenMeteoResponse {
	daily?: OpenMeteoDaily;
	reason?: string;
	error?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime());
}

function isValidLat(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90;
}

function isValidLng(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180;
}

export const weatherHistoryDefinition: ToolDefinition = {
	name: "weather_history",
	description:
		"Look up weather conditions (temperature, precipitation, wind) for a specific date and location. Works for both past dates (historical archive) and future dates up to 16 days ahead (forecast). Useful for contextualizing ride performance and planning upcoming rides.",
	parameters: {
		type: "object",
		properties: {
			date: {
				type: "string",
				description: "Date in YYYY-MM-DD format (past or future up to 16 days)",
			},
			lat: {
				type: "number",
				description: "Latitude",
			},
			lng: {
				type: "number",
				description: "Longitude",
			},
		},
		required: ["date", "lat", "lng"],
	},
};

function isPastDate(dateStr: string): boolean {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const target = new Date(`${dateStr}T00:00:00Z`);
	return target < today;
}

async function fetchWeatherData(
	lat: number,
	lng: number,
	date: string,
): Promise<OpenMeteoResponse> {
	const isPast = isPastDate(date);
	const baseUrl = isPast
		? "https://archive-api.open-meteo.com/v1/archive"
		: "https://api.open-meteo.com/v1/forecast";

	const url = new URL(baseUrl);
	url.searchParams.set("latitude", String(lat));
	url.searchParams.set("longitude", String(lng));
	url.searchParams.set("start_date", date);
	url.searchParams.set("end_date", date);
	url.searchParams.set(
		"daily",
		[
			"temperature_2m_max",
			"temperature_2m_min",
			"precipitation_sum",
			"wind_speed_10m_max",
			"wind_direction_10m_dominant",
		].join(","),
	);
	url.searchParams.set("timezone", "auto");

	const response = await fetch(url, {
		headers: { Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(
			`Weather API failed: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as OpenMeteoResponse;
	if (data.error) {
		throw new Error(data.reason ?? "Weather API returned an error.");
	}
	return data;
}

export const weatherHistoryHandler: ToolHandler = async (args) => {
	const end = debug.time("tool", "weather_history");
	try {
		const date = typeof args.date === "string" ? args.date.trim() : "";
		const lat = args.lat;
		const lng = args.lng;

		debug.log("tool", "weather_history params", { date, lat, lng });

		if (!isValidDateString(date)) {
			return {
				id: "",
				name: "weather_history",
				content: "",
				display: null,
				error: "`date` must be in YYYY-MM-DD format.",
			};
		}
		if (!isValidLat(lat) || !isValidLng(lng)) {
			return {
				id: "",
				name: "weather_history",
				content: "",
				display: null,
				error: "`lat` must be in [-90, 90] and `lng` in [-180, 180].",
			};
		}

		const data = await fetchWeatherData(lat, lng, date);
		const daily = data.daily;
		if (!daily?.time?.[0]) {
			return {
				id: "",
				name: "weather_history",
				content: "",
				display: null,
				error: "No weather data available for that date.",
			};
		}

		const idx = 0;
		const tempMax = daily.temperature_2m_max?.[idx] ?? null;
		const tempMin = daily.temperature_2m_min?.[idx] ?? null;
		const precip = daily.precipitation_sum?.[idx] ?? null;
		const windMax = daily.wind_speed_10m_max?.[idx] ?? null;
		const windDir = daily.wind_direction_10m_dominant?.[idx] ?? null;

		const isPast = isPastDate(date);
		const label = isPast ? "Historical weather" : "Forecast";
		const fmt = (v: number | null, suffix: string) =>
			v == null ? "n/a" : `${v}${suffix}`;
		const content = [
			`${label} on ${date} at (${lat}, ${lng}):`,
			`- High temperature: ${fmt(tempMax, "°C")}`,
			`- Low temperature: ${fmt(tempMin, "°C")}`,
			`- Precipitation: ${fmt(precip, " mm")}`,
			`- Max wind: ${fmt(windMax, " km/h")}`,
			`- Dominant wind direction: ${fmt(windDir, "°")}`,
		].join("\n");

		return {
			id: "",
			name: "weather_history",
			content,
			display: {
				date,
				location: { lat, lng },
				tempMax,
				tempMin,
				precip,
				windMax,
				windDir,
				isForecast: !isPast,
			},
		};
	} finally {
		end();
	}
};
