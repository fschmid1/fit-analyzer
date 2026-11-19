import type { PlanTargetId } from "@fit-analyzer/shared";
import { db } from "../db.js";
import type { IcuSyncMark } from "./intervalsIcuPlanSync.js";

/**
 * Plan write marks: when the server last wrote a given sync key to a target.
 *
 * Google stamps each event with its own metadata, so it needs no marks here.
 * IntervalsIcu has no per-event slot we own, so this table is how an athlete's
 * edit on the primary target is told apart from our own write. It is write
 * metadata, never the plan: the target stays the plan of record (ADR-0002,
 * narrowed by ADR-0005).
 */

interface MarkRow {
	sync_key: string;
	written_at: number;
}

const getMarksStmt = db.prepare<MarkRow, [string, string]>(
	"SELECT sync_key, written_at FROM plan_sync_marks WHERE user_id = ? AND target = ?",
);

const upsertMarkStmt = db.prepare(
	`INSERT INTO plan_sync_marks (user_id, target, sync_key, written_at)
	 VALUES (?, ?, ?, ?)
	 ON CONFLICT(user_id, target, sync_key) DO UPDATE SET
	   written_at = excluded.written_at`,
);

const deleteMarkStmt = db.prepare(
	"DELETE FROM plan_sync_marks WHERE user_id = ? AND target = ? AND sync_key = ?",
);

const clearMarksStmt = db.prepare(
	"DELETE FROM plan_sync_marks WHERE user_id = ? AND target = ?",
);

export function getPlanSyncMarks(
	userId: string,
	target: PlanTargetId,
): IcuSyncMark[] {
	return getMarksStmt.all(userId, target).map((row) => ({
		syncKey: row.sync_key,
		writtenAt: row.written_at,
	}));
}

export function recordPlanSyncMark(
	userId: string,
	target: PlanTargetId,
	mark: IcuSyncMark,
): void {
	upsertMarkStmt.run(userId, target, mark.syncKey, mark.writtenAt);
}

export function forgetPlanSyncMark(
	userId: string,
	target: PlanTargetId,
	syncKey: string,
): void {
	deleteMarkStmt.run(userId, target, syncKey);
}

/** Drop every mark for a target — e.g. when the connection is removed. */
export function clearPlanSyncMarks(userId: string, target: PlanTargetId): void {
	clearMarksStmt.run(userId, target);
}
