import { useCallback, useEffect, useState } from "react";
import {
	AlertCircle,
	CheckCircle2,
	History,
	KeyRound,
	Link2Off,
	Loader2,
	RefreshCw,
	Settings2,
} from "lucide-react";
import type { IntervalsIcuStatus } from "@fit-analyzer/shared";
import {
	connectIntervalsIcu,
	disconnectIntervalsIcu,
	fetchIntervalsIcuStatus,
	fetchTrainingTimezone,
	startIntervalsIcuBackfill,
	syncIntervalsIcuNow,
} from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";
import { ConnectCard } from "./ConnectCard";
import { TrainingTimezoneField } from "./TrainingTimezoneField";
import { SettingsBanner } from "../pages/settings/settingsShared";

const BACKFILL_OPTIONS = [
	{ days: 90, label: "Last 90 days" },
	{ days: 180, label: "Last 180 days" },
	{ days: 365, label: "Last year" },
	{ days: 730, label: "Last 2 years" },
	{ days: 1825, label: "Last 5 years" },
	{ days: 3650, label: "Last 10 years" },
] as const;

/** "the last 90 days" / "the last year" / "the last 2 years". */
function backfillRangeLabel(days: number | null): string {
	if (days == null) return "the last 90 days";
	if (days === 365) return "the last year";
	if (days > 365 && days % 365 === 0) return `the last ${days / 365} years`;
	return `the last ${days} days`;
}

const INPUT_CLASS =
	"px-3 py-2 text-xs bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]";

/**
 * IntervalsIcu connection card. v1 uses a personal API key; OAuth is a later,
 * additive path. Connecting can opt in to a background history import (90 days
 * by default, up to 10 years), and a connected athlete can start a longer
 * import at any time.
 *
 * Disconnecting forgets the key only: planned workouts already on
 * intervals.icu are left in place (ADR-0005).
 */
export function IntervalsIcuConnect({
	onSynced,
}: {
	/** Called after a sync or history import updates activities and sessions. */
	onSynced?: () => void;
}) {
	const [status, setStatus] = useState<IntervalsIcuStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [apiKey, setApiKey] = useState("");
	const [backfillDays, setBackfillDays] = useState(0);
	const [historyDays, setHistoryDays] = useState(90);
	const [importing, setImporting] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [syncResult, setSyncResult] = useState<string | null>(null);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	const load = useCallback(async () => {
		try {
			setStatus(await fetchIntervalsIcuStatus());
		} catch {
			setNotification({ type: "error", message: "Failed to load status." });
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Poll while a history import is running so progress moves without a refresh.
	// A finished run refreshes the history once, so a long import shows up as
	// soon as it lands.
	useEffect(() => {
		if (status?.backfill.status !== "running") return;
		const id = window.setInterval(() => {
			void fetchIntervalsIcuStatus()
				.then((next) => {
					setStatus(next);
					if (next.backfill.status !== "running") onSynced?.();
				})
				.catch(() => {});
		}, 4000);
		return () => window.clearInterval(id);
	}, [status?.backfill.status, onSynced]);

	useEffect(() => {
		if (!notification) return;
		const id = setTimeout(() => setNotification(null), 5000);
		return () => clearTimeout(id);
	}, [notification]);

	const handleConnect = async () => {
		if (!apiKey.trim()) {
			setNotification({ type: "error", message: "Paste your API key first." });
			return;
		}
		setConnecting(true);
		try {
			const timezone =
				(await fetchTrainingTimezone()) ??
				Intl.DateTimeFormat().resolvedOptions().timeZone;
			const next = await connectIntervalsIcu({
				apiKey: apiKey.trim(),
				timezone,
				backfillDays: backfillDays > 0 ? backfillDays : null,
			});
			setStatus(next);
			setApiKey("");
			setNotification({
				type: "success",
				message:
					backfillDays > 0
						? `Connected. Importing ${backfillRangeLabel(backfillDays)} in the background.`
						: "Connected to intervals.icu.",
			});
		} catch (err) {
			setNotification({
				type: "error",
				message: (err as Error).message || "Failed to connect.",
			});
		} finally {
			setConnecting(false);
		}
	};

	const handleDisconnect = async () => {
		setDisconnecting(true);
		try {
			await disconnectIntervalsIcu();
			setStatus(await fetchIntervalsIcuStatus());
			setNotification({
				type: "success",
				message:
					"Disconnected. Planned workouts already on intervals.icu were left in place.",
			});
		} catch {
			setNotification({ type: "error", message: "Failed to disconnect." });
		} finally {
			setDisconnecting(false);
		}
	};

	const handleSync = async () => {
		setSyncing(true);
		setSyncResult(null);
		try {
			const result = await syncIntervalsIcuNow();
			const parts: string[] = [];
			if (result.imported) parts.push(`${result.imported} rides imported`);
			if (result.sessionsImported)
				parts.push(`${result.sessionsImported} sessions imported`);
			if (result.updated) parts.push(`${result.updated} rides updated`);
			if (result.sessionsUpdated)
				parts.push(`${result.sessionsUpdated} sessions updated`);
			parts.push(`${result.skipped} already known`);
			if (result.failed) parts.push(`${result.failed} failed`);
			setSyncResult(`${parts.join(", ")}.`);
			setStatus(await fetchIntervalsIcuStatus());
			onSynced?.();
		} catch (err) {
			setNotification({
				type: "error",
				message: (err as Error).message || "Sync failed.",
			});
		} finally {
			setSyncing(false);
		}
	};

	const handleBackfill = async () => {
		setImporting(true);
		try {
			const next = await startIntervalsIcuBackfill(historyDays);
			setStatus(next);
			setNotification({
				type: "success",
				message: `Importing ${backfillRangeLabel(historyDays)} in the background.`,
			});
		} catch (err) {
			setNotification({
				type: "error",
				message: (err as Error).message || "Failed to start history import.",
			});
		} finally {
			setImporting(false);
		}
	};

	const backfillProgress = status?.backfill;
	const backfillRunning = backfillProgress?.status === "running";
	const keyRevoked = status?.connected && status.keyValid === false;

	return (
		<ConnectCard
			title="intervals.icu"
			accent="#0ea5e9"
			loading={loading}
			connected={status?.connected ?? null}
			statusText={
				loading
					? "Checking connection…"
					: status?.connected
						? keyRevoked
							? "Key rejected — reconnect"
							: `Connected${status.athleteName ? ` · ${status.athleteName}` : ""}`
						: "Not connected"
			}
			icon={<Settings2 className="w-5 h-5 text-[#0ea5e9]" />}
		>
			{notification && <SettingsBanner notification={notification} />}

			{!loading && !status?.connected && (
				<>
					<p className="text-xs text-[#94a3b8]">
						Connect with a personal API key so the coach can plan workouts on
						your intervals.icu calendar. Create one under Settings → API on
						intervals.icu (username <code>API_KEY</code>, the key is the
						password). Completed activities — rides, strength sessions, runs and
						swims — are imported automatically every few minutes.
					</p>
					<TrainingTimezoneField />
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="intervals-connect-history"
							className="text-xs font-medium text-[#f1f5f9]"
						>
							Import history
						</label>
						<select
							id="intervals-connect-history"
							value={backfillDays}
							onChange={(e) => setBackfillDays(Number(e.target.value))}
							className={INPUT_CLASS}
						>
							<option value={0}>Don't import history</option>
							{BACKFILL_OPTIONS.map((option) => (
								<option key={option.days} value={option.days}>
									{option.label}
								</option>
							))}
						</select>
						<p className="text-[11px] text-[#7c6fa0]">
							Runs in the background; activities already imported are skipped.
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="intervals-api-key"
							className="text-xs font-medium text-[#f1f5f9]"
						>
							Personal API key
						</label>
						<input
							id="intervals-api-key"
							type="password"
							autoComplete="off"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Paste your intervals.icu API key"
							className={INPUT_CLASS}
						/>
					</div>
					<AnimatedButton
						onClick={handleConnect}
						disabled={connecting}
						className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-[#0ea5e9] hover:bg-[#0284c7] rounded-xl transition-colors duration-200 cursor-pointer disabled:opacity-50"
					>
						{connecting ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<KeyRound className="w-4 h-4" />
						)}
						{connecting ? "Connecting…" : "Connect intervals.icu"}
					</AnimatedButton>
				</>
			)}

			{!loading && status?.connected && (
				<div className="flex flex-col gap-3">
					<TrainingTimezoneField />
					{keyRevoked && (
						<div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
							<AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
							intervals.icu rejected the stored key, so the importer is paused.
							Disconnect and reconnect with a fresh key.
						</div>
					)}

					{backfillProgress && backfillProgress.status !== "idle" && (
						<div className="flex items-start gap-2 text-xs text-[#94a3b8]">
							{backfillProgress.status === "running" ? (
								<Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-[#0ea5e9]" />
							) : backfillProgress.status === "done" ? (
								<CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400" />
							) : (
								<AlertCircle className="w-3.5 h-3.5 mt-0.5 text-amber-400" />
							)}
							<span>
								{backfillProgress.status === "running"
									? `Importing ${backfillRangeLabel(backfillProgress.days)}…`
									: backfillProgress.status === "done"
										? `Imported ${backfillRangeLabel(backfillProgress.days)}.`
										: `Import of ${backfillRangeLabel(backfillProgress.days)} stopped.`}{" "}
								{backfillProgress.imported} imported
								{backfillProgress.failed
									? `, ${backfillProgress.failed} failed`
									: ""}
								{backfillProgress.error ? ` — ${backfillProgress.error}` : ""}
							</span>
						</div>
					)}

					{status.lastSyncAt && (
						<p className="text-[11px] text-[#7c6fa0]">
							Last activity sync: {new Date(status.lastSyncAt).toLocaleString()}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-3">
						<AnimatedButton
							onClick={handleSync}
							disabled={syncing}
							title="Import the last 90 days now"
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#bae6fd] bg-[#0ea5e9]/10 hover:bg-[#0ea5e9]/20 border border-[#0ea5e9]/20 rounded-xl transition-colors duration-200 cursor-pointer disabled:opacity-50"
						>
							{syncing ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<RefreshCw className="w-3.5 h-3.5" />
							)}
							{syncing ? "Syncing…" : "Sync now"}
						</AnimatedButton>
						{syncResult && (
							<span className="text-[11px] text-[#94a3b8]">{syncResult}</span>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="intervals-import-history"
							className="text-xs font-medium text-[#f1f5f9]"
						>
							Import older history
						</label>
						<div className="flex flex-wrap items-center gap-2">
							<select
								id="intervals-import-history"
								value={historyDays}
								onChange={(e) => setHistoryDays(Number(e.target.value))}
								disabled={backfillRunning}
								className={INPUT_CLASS}
							>
								{BACKFILL_OPTIONS.map((option) => (
									<option key={option.days} value={option.days}>
										{option.label}
									</option>
								))}
							</select>
							<AnimatedButton
								onClick={handleBackfill}
								disabled={backfillRunning || importing}
								className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#bae6fd] bg-[#0ea5e9]/10 hover:bg-[#0ea5e9]/20 border border-[#0ea5e9]/20 rounded-xl transition-colors duration-200 cursor-pointer disabled:opacity-50"
							>
								{backfillRunning || importing ? (
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
								) : (
									<History className="w-3.5 h-3.5" />
								)}
								{backfillRunning
									? "Importing…"
									: importing
										? "Starting…"
										: "Import"}
							</AnimatedButton>
						</div>
						<p className="text-[11px] text-[#7c6fa0]">
							Runs in the background; activities already imported are skipped.
						</p>
					</div>

					<div className="pt-1 border-t border-[rgba(139,92,246,0.1)]">
						<AnimatedButton
							onClick={handleDisconnect}
							disabled={disconnecting}
							className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-red-400 transition-colors duration-200 cursor-pointer disabled:opacity-50"
						>
							{disconnecting ? (
								<Loader2 className="w-3 h-3 animate-spin" />
							) : (
								<Link2Off className="w-3 h-3" />
							)}
							Disconnect
						</AnimatedButton>
					</div>
				</div>
			)}
		</ConnectCard>
	);
}
