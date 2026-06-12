import type { ReactNode } from "react";

interface RideRecommendationDisplay {
	recommendation: string;
	rationale: string;
	weather?: {
		tempMax: number | null;
		tempMin: number | null;
		precip: number | null;
		windMax: number | null;
	} | null;
	trainingLoad?: {
		ctl: number;
		atl: number;
		tsb: number;
		form: string;
	} | null;
	phase?: string | null;
}

export function renderRideRecommendation(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as RideRecommendationDisplay;
	if (!d.recommendation) return null;

	return (
		<div className="space-y-1.5">
			<div className="text-[12px] font-semibold text-[#f1f5f9]">
				{d.recommendation}
			</div>
			<div className="text-[11px] text-[#c4b5fd]">{d.rationale}</div>
			{(d.trainingLoad || d.weather || d.phase) && (
				<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#7c6fa0]">
					{d.trainingLoad && (
						<>
							<span>CTL {d.trainingLoad.ctl}</span>
							<span>ATL {d.trainingLoad.atl}</span>
							<span>
								TSB {d.trainingLoad.tsb} ({d.trainingLoad.form})
							</span>
						</>
					)}
					{d.phase && <span>Phase: {d.phase}</span>}
					{d.weather && (
						<>
							{d.weather.tempMax != null && (
								<span>{d.weather.tempMax}\u00B0C</span>
							)}
							{d.weather.precip != null && (
								<span>{d.weather.precip}mm rain</span>
							)}
							{d.weather.windMax != null && (
								<span>{d.weather.windMax}km/h wind</span>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
