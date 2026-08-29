import type { ReactNode } from "react";
import type { CalendarSyncResult, CalendarSyncRow } from "@fit-analyzer/shared";

function formatRow(row: CalendarSyncRow): string {
	const d = new Date(`${row.date}T12:00:00Z`);
	const label = d.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});
	return `${label} · ${row.startTime} · ${row.focus}`;
}

function RowList({ rows, color }: { rows: CalendarSyncRow[]; color: string }) {
	return (
		<div className="space-y-0.5">
			{rows.map((row, i) => (
				<div key={`${row.date}-${row.startTime}-${i}`} className="text-[11px]">
					<span className={color}>{formatRow(row)}</span>
				</div>
			))}
		</div>
	);
}

export function renderCalendarSync(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as CalendarSyncResult;
	if (!Array.isArray(d.created)) return null;

	const total =
		(d.created?.length ?? 0) +
		(d.updated?.length ?? 0) +
		(d.deleted ?? 0) +
		(d.errors?.length ?? 0);
	if (total === 0) return null;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 flex-wrap text-[11px]">
				<span className="font-semibold text-[#c4b5fd]">
					Training calendar synced
				</span>
				<span className="text-[#7c6fa0]">
					{[
						d.created?.length ? `${d.created.length} added` : null,
						d.updated?.length ? `${d.updated.length} updated` : null,
						d.deleted ? `${d.deleted} removed` : null,
						d.skipped?.length || d.skippedEdits
							? `${(d.skipped?.length ?? 0) + (d.skippedEdits ?? 0)} left (your edits)`
							: null,
					]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</div>
			<RowList rows={d.created ?? []} color="text-[#c4b5fd]" />
			<RowList rows={d.updated ?? []} color="text-[#94a3b8]" />
			<RowList rows={d.deletedRows ?? []} color="text-[#64748b] line-through" />
			{d.errors && d.errors.length > 0 && (
				<div className="text-[11px] text-red-400">
					{d.errors.map((err) => (
						<div key={err}>{err}</div>
					))}
				</div>
			)}
		</div>
	);
}

export function renderCalendarRemoval(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as { removed?: CalendarSyncRow[]; skipped?: number };
	if (!Array.isArray(d.removed)) return null;
	if (d.removed.length === 0 && !d.skipped) return null;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2 flex-wrap text-[11px]">
				<span className="font-semibold text-[#c4b5fd]">Calendar cleared</span>
				<span className="text-[#7c6fa0]">
					{d.removed.length} removed
					{d.skipped ? ` · ${d.skipped} left (your edits)` : ""}
				</span>
			</div>
			<RowList rows={d.removed} color="text-[#94a3b8]" />
		</div>
	);
}
