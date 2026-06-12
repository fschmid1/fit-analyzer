import type { ReactNode } from "react";

interface TrainingLoadDisplay {
	ftp: number;
	days: number;
	totalTss: number;
	dates: string[];
	tss: number[];
	ctl: number[];
	atl: number[];
	tsb: number[];
	current: {
		ctl: number;
		atl: number;
		tsb: number;
		form: string;
	};
}

function sparklinePath(
	values: number[],
	width: number,
	height: number,
): string {
	if (values.length < 2) return "";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = max - min || 1;
	const stepX = width / (values.length - 1);
	const points = values.map((v, i) => ({
		x: i * stepX,
		y: height - ((v - min) / range) * height,
	}));
	return points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
		.join(" ");
}

export function renderTrainingLoad(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as TrainingLoadDisplay;
	if (!d.current || !Array.isArray(d.dates) || d.dates.length === 0)
		return null;

	const width = 200;
	const height = 50;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-3 flex-wrap">
				<span className="text-[11px]">
					<span className="text-blue-400 font-semibold">CTL</span>{" "}
					<span className="text-blue-300">{d.current.ctl}</span>
				</span>
				<span className="text-[11px]">
					<span className="text-red-400 font-semibold">ATL</span>{" "}
					<span className="text-red-300">{d.current.atl}</span>
				</span>
				<span className="text-[11px]">
					<span className="text-emerald-400 font-semibold">TSB</span>{" "}
					<span className="text-emerald-300">{d.current.tsb}</span>
				</span>
				<span className="text-[11px] text-[#7c6fa0]">({d.current.form})</span>
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="w-full max-w-[220px] h-auto"
				style={{ display: "block" }}
				role="img"
				aria-label="PMC sparkline"
			>
				{sparklinePath(d.ctl, width, height) && (
					<path
						d={sparklinePath(d.ctl, width, height)}
						fill="none"
						stroke="rgba(96,165,250,0.7)"
						strokeWidth="1.5"
					/>
				)}
				{sparklinePath(d.atl, width, height) && (
					<path
						d={sparklinePath(d.atl, width, height)}
						fill="none"
						stroke="rgba(248,113,113,0.7)"
						strokeWidth="1.5"
					/>
				)}
				{sparklinePath(d.tsb, width, height) && (
					<path
						d={sparklinePath(d.tsb, width, height)}
						fill="none"
						stroke="rgba(52,211,153,0.7)"
						strokeWidth="1.5"
					/>
				)}
			</svg>
			<div className="text-[10px] text-[#7c6fa0]">
				FTP: {d.ftp}W · {d.days}d lookback · TSS: {d.totalTss}
			</div>
		</div>
	);
}
