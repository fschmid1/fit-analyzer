import type { ReactNode } from "react";

interface WeatherDisplay {
	date: string;
	location: { lat: number; lng: number };
	tempMax: number | null;
	tempMin: number | null;
	feelsLikeMax: number | null;
	feelsLikeMin: number | null;
	humidityMax: number | null;
	humidityMin: number | null;
	dewPoint: number | null;
	precip: number | null;
	windMax: number | null;
	windDir: number | null;
	isForecast: boolean;
}

function weatherIcon(
	precip: number | null,
	windMax: number | null,
	tempMax: number | null,
): string {
	if (tempMax != null && tempMax >= 28) return "\u{1F325}\uFE0F";
	if (precip != null && precip > 0) return "\u{1F327}\uFE0F";
	if (windMax != null && windMax > 30) return "\u{1F32C}\uFE0F";
	return "\u2600\uFE0F";
}

function windDirection(deg: number | null): string {
	if (deg == null) return "—";
	const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
	return dirs[Math.round(deg / 45) % 8];
}

export function renderWeatherHistory(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as WeatherDisplay;
	if (d.date == null) return null;

	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2">
				<span className="text-lg">
					{weatherIcon(d.precip, d.windMax, d.tempMax)}
				</span>
				<span className="text-[11px] font-medium text-[#c4b5fd]">
					{d.isForecast ? "Forecast" : "Weather"} · {d.date}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
				<div>
					<span className="text-[#7c6fa0]">High </span>
					<span className="text-[#c4b5fd]">
						{d.tempMax != null ? `${d.tempMax}\u00B0C` : "—"}
					</span>
				</div>
				<div>
					<span className="text-[#7c6fa0]">Low </span>
					<span className="text-[#c4b5fd]">
						{d.tempMin != null ? `${d.tempMin}\u00B0C` : "—"}
					</span>
				</div>
				<div>
					<span className="text-[#7c6fa0]">Feels </span>
					<span className="text-[#c4b5fd]">
						{d.feelsLikeMax != null ? `${d.feelsLikeMax}\u00B0C` : "—"}
					</span>
				</div>
				<div>
					<span className="text-[#7c6fa0]">Dew </span>
					<span className="text-[#c4b5fd]">
						{d.dewPoint != null ? `${d.dewPoint}\u00B0C` : "—"}
					</span>
				</div>
				<div>
					<span className="text-[#7c6fa0]">Humidity </span>
					<span className="text-[#c4b5fd]">
						{d.humidityMax != null
							? `${d.humidityMin ?? "?"}\u2013${d.humidityMax}%`
							: "—"}
					</span>
				</div>
				<div>
					<span className="text-[#7c6fa0]">Precip </span>
					<span className="text-[#c4b5fd]">
						{d.precip != null ? `${d.precip} mm` : "—"}
					</span>
				</div>
				<div className="col-span-2">
					<span className="text-[#7c6fa0]">Wind </span>
					<span className="text-[#c4b5fd]">
						{d.windMax != null
							? `${d.windMax} km/h ${windDirection(d.windDir)}`
							: "—"}
					</span>
				</div>
			</div>
		</div>
	);
}
