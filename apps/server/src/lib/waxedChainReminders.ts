import type {
	StoredRecord,
	WaxedChainReminderSettings,
} from "@fit-analyzer/shared";
import { db } from "../db.js";
import { env } from "../env.js";

const DEFAULT_THRESHOLD_KM = 300;

interface UserSettingsRow {
	waxed_chain_reminders_enabled: number;
	waxed_chain_reminder_km: number;
	waxed_chain_ntfy_topic: string;
	waxed_chain_accumulated_km: number;
	waxed_chain_last_notified_at: string | null;
}

const getSettingsStmt = db.prepare<UserSettingsRow, [string]>(
	`SELECT
      waxed_chain_reminders_enabled,
      waxed_chain_reminder_km,
      waxed_chain_ntfy_topic,
      waxed_chain_accumulated_km,
      waxed_chain_last_notified_at
   FROM user_settings
   WHERE user_id = ?`,
);

const upsertSettingsStmt = db.prepare(
	`INSERT INTO user_settings (
      user_id,
      waxed_chain_reminders_enabled,
      waxed_chain_reminder_km,
      waxed_chain_ntfy_topic
   ) VALUES (?, ?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET
      waxed_chain_reminders_enabled = excluded.waxed_chain_reminders_enabled,
      waxed_chain_reminder_km = excluded.waxed_chain_reminder_km,
      waxed_chain_ntfy_topic = excluded.waxed_chain_ntfy_topic`,
);

const updateAccumulatedStmt = db.prepare(
	`INSERT INTO user_settings (
      user_id,
      waxed_chain_accumulated_km,
      waxed_chain_last_notified_at
   ) VALUES (?, ?, ?)
   ON CONFLICT(user_id) DO UPDATE SET
      waxed_chain_accumulated_km = excluded.waxed_chain_accumulated_km,
      waxed_chain_last_notified_at = excluded.waxed_chain_last_notified_at`,
);

function sanitizeThresholdKm(value: number): number {
	return Number.isFinite(value) && value > 0
		? Math.round(value)
		: DEFAULT_THRESHOLD_KM;
}

function roundKm(value: number): number {
	return Math.round(value * 10) / 10;
}

function toPublicSettings(
	row: UserSettingsRow | null,
): WaxedChainReminderSettings {
	const thresholdKm = sanitizeThresholdKm(
		row?.waxed_chain_reminder_km ?? DEFAULT_THRESHOLD_KM,
	);
	const accumulatedKm = Math.max(0, row?.waxed_chain_accumulated_km ?? 0);
	const remainingKm =
		accumulatedKm >= thresholdKm ? 0 : thresholdKm - accumulatedKm;

	return {
		enabled: Boolean(row?.waxed_chain_reminders_enabled ?? 0),
		thresholdKm,
		ntfyTopic: row?.waxed_chain_ntfy_topic ?? "",
		accumulatedKm: roundKm(accumulatedKm),
		remainingKm: roundKm(remainingKm),
		lastNotifiedAt: row?.waxed_chain_last_notified_at ?? null,
	};
}

export function computeDistanceKm(records: StoredRecord[]): number {
	if (records.length < 2) return 0;

	let distanceKm = 0;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i - 1];
		const current = records[i];
		const dt = current.elapsedSeconds - prev.elapsedSeconds;

		if (!Number.isFinite(dt) || dt <= 0) continue;

		const prevSpeed = prev.speed;
		const currentSpeed = current.speed;

		if (prevSpeed === null && currentSpeed === null) continue;

		const sampleSpeedKmh =
			prevSpeed !== null && currentSpeed !== null
				? (prevSpeed + currentSpeed) / 2
				: (currentSpeed ?? prevSpeed ?? 0);

		distanceKm += sampleSpeedKmh * (dt / 3600);
	}

	return distanceKm;
}

async function sendWaxedChainReminder(
	topic: string,
	thresholdKm: number,
	accumulatedKm: number,
) {
	if (!env.NTFY_HOST) {
		throw new Error("NTFY_HOST is not configured");
	}

	const headers = new Headers({
		"Content-Type": "text/plain; charset=utf-8",
		Title: "Waxed chain reminder",
		Tags: "bicycle,maintenance",
	});

	if (env.NTFY_TOKEN) {
		// ntfy accepts access tokens via Basic auth with an empty username.
		headers.set(
			"Authorization",
			`Basic ${Buffer.from(`:${env.NTFY_TOKEN}`).toString("base64")}`,
		);
	}

	const response = await fetch(
		`${env.NTFY_HOST.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`,
		{
			method: "POST",
			headers,
			body: `You rode ${roundKm(accumulatedKm)} km since the last chain wax. Configured reminder: ${thresholdKm} km.`,
		},
	);

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(
			`ntfy request failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`,
		);
	}
}

export async function sendTestWaxedChainReminder(
	userId: string,
): Promise<void> {
	const settings = getWaxedChainReminderSettings(userId);

	if (!settings.ntfyTopic) {
		throw new Error("ntfyTopic is not configured");
	}

	await sendWaxedChainReminder(
		settings.ntfyTopic,
		settings.thresholdKm,
		settings.accumulatedKm,
	);
}

export function getWaxedChainReminderSettings(
	userId: string,
): WaxedChainReminderSettings {
	return toPublicSettings(getSettingsStmt.get(userId) ?? null);
}

export function updateWaxedChainReminderSettings(
	userId: string,
	input: { enabled: boolean; thresholdKm: number; ntfyTopic: string },
): WaxedChainReminderSettings {
	upsertSettingsStmt.run(
		userId,
		input.enabled ? 1 : 0,
		sanitizeThresholdKm(input.thresholdKm),
		input.ntfyTopic.trim(),
	);

	return getWaxedChainReminderSettings(userId);
}

export function resetWaxedChainReminderProgress(
	userId: string,
): WaxedChainReminderSettings {
	updateAccumulatedStmt.run(userId, 0, null);
	return getWaxedChainReminderSettings(userId);
}

export async function handleNewActivityForWaxedChainReminder(
	userId: string,
	records: StoredRecord[],
): Promise<void> {
	const row = getSettingsStmt.get(userId) ?? null;
	const settings = toPublicSettings(row);

	if (!settings.enabled || !settings.ntfyTopic) {
		return;
	}

	const activityDistanceKm = computeDistanceKm(records);
	if (activityDistanceKm <= 0) {
		return;
	}

	const nextAccumulatedKm =
		(row?.waxed_chain_accumulated_km ?? 0) + activityDistanceKm;

	if (nextAccumulatedKm < settings.thresholdKm) {
		updateAccumulatedStmt.run(
			userId,
			nextAccumulatedKm,
			row?.waxed_chain_last_notified_at ?? null,
		);
		return;
	}

	try {
		await sendWaxedChainReminder(
			settings.ntfyTopic,
			settings.thresholdKm,
			nextAccumulatedKm,
		);
		updateAccumulatedStmt.run(
			userId,
			nextAccumulatedKm % settings.thresholdKm,
			new Date().toISOString(),
		);
	} catch (error) {
		updateAccumulatedStmt.run(
			userId,
			nextAccumulatedKm,
			row?.waxed_chain_last_notified_at ?? null,
		);
		console.error(
			`[waxed-chain] Failed to send reminder for user ${userId}:`,
			error,
		);
	}
}
