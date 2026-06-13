import type { ReactNode } from "react";

interface UpdateProfileDisplay {
	updated: string[];
	profile: {
		ftp: number | null;
		maxHr: number | null;
		goalEventDate: string | null;
		goalEventName: string | null;
		goalDescription: string | null;
		weeklyHours: number | null;
		focusAreas: string[];
	};
}

export function renderUpdateProfile(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as UpdateProfileDisplay;
	if (!Array.isArray(d.updated) || d.updated.length === 0) return null;

	const p = d.profile;
	const items: string[] = [];
	if (p.ftp != null) items.push(`FTP: ${p.ftp} W`);
	if (p.maxHr != null) items.push(`Max HR: ${p.maxHr} bpm`);
	if (p.weeklyHours != null) items.push(`${p.weeklyHours} h/wk`);
	if (p.goalEventName || p.goalEventDate) {
		items.push(`${p.goalEventName ?? "Event"} · ${p.goalEventDate ?? "TBD"}`);
	}
	if (p.focusAreas.length > 0) items.push(p.focusAreas.join(", "));

	return (
		<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
			{items.map((item) => (
				<span
					key={item}
					className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
				>
					{item}
				</span>
			))}
		</div>
	);
}
