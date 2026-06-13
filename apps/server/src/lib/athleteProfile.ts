import { db } from "../db.js";
import type { AthleteProfile } from "@fit-analyzer/shared";

const getProfileStmt = db.prepare(
	`SELECT athlete_ftp, athlete_max_hr, athlete_goal_event_date,
	        athlete_goal_event_name, athlete_goal_description,
	        athlete_weekly_hours, athlete_focus_areas
     FROM user_settings WHERE user_id = ?`,
);

const upsertFtpStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_ftp) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_ftp = excluded.athlete_ftp`,
);

const upsertMaxHrStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_max_hr) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_max_hr = excluded.athlete_max_hr`,
);

const upsertGoalEventDateStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_goal_event_date) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_goal_event_date = excluded.athlete_goal_event_date`,
);

const upsertGoalEventNameStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_goal_event_name) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_goal_event_name = excluded.athlete_goal_event_name`,
);

const upsertGoalDescriptionStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_goal_description) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_goal_description = excluded.athlete_goal_description`,
);

const upsertWeeklyHoursStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_weekly_hours) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_weekly_hours = excluded.athlete_weekly_hours`,
);

const upsertFocusAreasStmt = db.prepare(
	`INSERT INTO user_settings (user_id, athlete_focus_areas) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET athlete_focus_areas = excluded.athlete_focus_areas`,
);

interface ProfileRow {
	athlete_ftp: number | null;
	athlete_max_hr: number | null;
	athlete_goal_event_date: string | null;
	athlete_goal_event_name: string | null;
	athlete_goal_description: string | null;
	athlete_weekly_hours: number | null;
	athlete_focus_areas: string;
}

export function getAthleteProfile(userId: string): AthleteProfile {
	const row = getProfileStmt.get(userId) as ProfileRow | undefined;
	if (!row) {
		return {
			ftp: null,
			maxHr: null,
			goalEventDate: null,
			goalEventName: null,
			goalDescription: null,
			weeklyHours: null,
			focusAreas: [],
		};
	}

	let focusAreas: string[] = [];
	try {
		const parsed = JSON.parse(row.athlete_focus_areas);
		if (Array.isArray(parsed)) focusAreas = parsed;
	} catch {
		/* ignore */
	}

	return {
		ftp: row.athlete_ftp,
		maxHr: row.athlete_max_hr,
		goalEventDate: row.athlete_goal_event_date,
		goalEventName: row.athlete_goal_event_name,
		goalDescription: row.athlete_goal_description,
		weeklyHours: row.athlete_weekly_hours,
		focusAreas,
	};
}

export function updateAthleteProfile(
	userId: string,
	updates: {
		ftp?: number | null;
		maxHr?: number | null;
		goalEventDate?: string | null;
		goalEventName?: string | null;
		goalDescription?: string | null;
		weeklyHours?: number | null;
		focusAreas?: string[];
	},
): AthleteProfile {
	if (updates.ftp !== undefined) upsertFtpStmt.run(userId, updates.ftp);
	if (updates.maxHr !== undefined) upsertMaxHrStmt.run(userId, updates.maxHr);
	if (updates.goalEventDate !== undefined)
		upsertGoalEventDateStmt.run(userId, updates.goalEventDate);
	if (updates.goalEventName !== undefined)
		upsertGoalEventNameStmt.run(userId, updates.goalEventName);
	if (updates.goalDescription !== undefined)
		upsertGoalDescriptionStmt.run(userId, updates.goalDescription);
	if (updates.weeklyHours !== undefined)
		upsertWeeklyHoursStmt.run(userId, updates.weeklyHours);
	if (updates.focusAreas !== undefined)
		upsertFocusAreasStmt.run(userId, JSON.stringify(updates.focusAreas));

	return getAthleteProfile(userId);
}
