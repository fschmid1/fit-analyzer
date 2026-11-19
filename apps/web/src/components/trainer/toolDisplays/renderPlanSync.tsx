import type { ReactNode } from "react";
import type {
	CalendarSyncRow,
	PlanRemovalResult,
	PlanSyncResult,
	PlanTargetSyncResult,
} from "@fit-analyzer/shared";
import { planTargetLabel } from "@fit-analyzer/shared";

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

/** One target's counts line, then its added/updated/removed workouts. */
function TargetSection({ result }: { result: PlanTargetSyncResult }) {
	const overwritten = result.overwritten?.length ?? 0;
	const total =
		(result.created?.length ?? 0) +
		(result.updated?.length ?? 0) +
		(result.deleted ?? 0) +
		overwritten +
		(result.errors?.length ?? 0) +
		(result.skipped?.length ?? 0) +
		(result.skippedEdits ?? 0);

	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2 flex-wrap text-[11px]">
				<span className="font-semibold text-[#c4b5fd]">
					{planTargetLabel(result.target)}
				</span>
				<span className="text-[#7c6fa0]">
					{total === 0
						? "no changes"
						: [
								result.created?.length
									? `${result.created.length} added`
									: null,
								result.updated?.length
									? `${result.updated.length} updated`
									: null,
								result.deleted ? `${result.deleted} removed` : null,
								result.overwritten?.length
									? `${result.overwritten.length} overwritten (your edits)`
									: null,
								result.skipped?.length || result.skippedEdits
									? `${(result.skipped?.length ?? 0) + (result.skippedEdits ?? 0)} left (started or edited)`
									: null,
							]
								.filter(Boolean)
								.join(" · ")}
				</span>
			</div>
			<RowList rows={result.created ?? []} color="text-[#c4b5fd]" />
			<RowList rows={result.updated ?? []} color="text-[#94a3b8]" />
			<RowList rows={result.overwritten ?? []} color="text-[#fbbf24]" />
			<RowList
				rows={result.deletedRows ?? []}
				color="text-[#64748b] line-through"
			/>
			{result.errors && result.errors.length > 0 && (
				<div className="text-[11px] text-red-400">
					{result.errors.map((err) => (
						<div key={err}>{err}</div>
					))}
				</div>
			)}
		</div>
	);
}

export function renderPlanSync(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as PlanSyncResult;
	if (!Array.isArray(d.targets)) return null;
	const anyWork = d.targets.some(
		(t) =>
			(t.created?.length ?? 0) +
				(t.updated?.length ?? 0) +
				(t.deleted ?? 0) +
				(t.overwritten?.length ?? 0) +
				(t.errors?.length ?? 0) >
			0,
	);
	if (!anyWork) return null;

	return (
		<div className="space-y-2">
			<span className="text-[11px] font-semibold text-[#c4b5fd]">
				Training plan synced
			</span>
			{d.targets.map((target) => (
				<TargetSection key={target.target} result={target} />
			))}
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

export function renderPlanRemoval(display: unknown): ReactNode | null {
	if (typeof display !== "object" || display === null) return null;
	const d = display as PlanRemovalResult;
	if (!Array.isArray(d.targets)) return null;
	const removed = d.targets.reduce((sum, t) => sum + t.removed.length, 0);
	const skipped = d.targets.reduce((sum, t) => sum + t.skipped, 0);
	const overwritten = d.targets.reduce(
		(sum, t) => sum + (t.overwritten?.length ?? 0),
		0,
	);
	if (removed === 0 && skipped === 0 && overwritten === 0) return null;

	return (
		<div className="space-y-2">
			<span className="text-[11px] font-semibold text-[#c4b5fd]">
				Planned workouts removed
			</span>
			{d.targets.map((target) => (
				<div key={target.target} className="space-y-0.5">
					<div className="text-[11px] text-[#7c6fa0]">
						{planTargetLabel(target.target)} · {target.removed.length} removed
						{target.skipped ? ` · ${target.skipped} left (your edits)` : ""}
						{target.overwritten?.length
							? ` · ${target.overwritten.length} overwritten (your edits)`
							: ""}
					</div>
					<RowList rows={target.removed} color="text-[#94a3b8]" />
					<RowList rows={target.overwritten ?? []} color="text-[#fbbf24]" />
				</div>
			))}
		</div>
	);
}
