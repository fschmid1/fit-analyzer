import { useCallback, useEffect, useState } from "react";
import {
	AlertCircle,
	CheckCircle2,
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
	syncIntervalsIcuNow,
} from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";
import { ConnectCard } from "./ConnectCard";
import { TrainingTimezoneField } from "./TrainingTimezoneField";
import { SettingsBanner } from "../pages/settings/settingsShared";

/**
 * IntervalsIcu connection card. v1 uses a personal API key; OAuth is a later,
 * additive path. Connecting also opts in (or not) to the 90-day activity
 * backfill, which runs in the background with progress shown here.
 *
 * Disconnecting forgets the key only: planned workouts already on
 * intervals.icu are left in place (ADR-0005).
 */
export function IntervalsIcuConnect() {
	const [status, setStatus] = useState<IntervalsIcuStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [apiKey, setApiKey] = useState("");
	const [backfill, setBackfill] = useState(false);
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

	// Poll while a backfill is running so progress moves without a refresh.
	useEffect(() => {
		if (status?.backfill.status !== "running") return;
		const id = window.setInterval(() => {
			void fetchIntervalsIcuStatus()
				.then(setStatus)
				.catch(() => {});
		}, 4000);
		return () => window.clearInterval(id);
	}, [status?.backfill.status]);

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
				backfill,
			});
			setStatus(next);
			setApiKey("");
			setNotification({
				type: "success",
				message: backfill
					? "Connected. Importing the last 90 days in the background."
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
			setSyncResult(
				`${result.imported} imported, ${result.updated} updated, ${
					result.skipped
				} already known${result.failed ? `, ${result.failed} failed` : ""}.`,
			);
			setStatus(await fetchIntervalsIcuStatus());
		} catch (err) {
			setNotification({
				type: "error",
				message: (err as Error).message || "Sync failed.",
			});
		} finally {
			setSyncing(false);
		}
	};

	const backfillProgress = status?.backfill;
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
						password). Rides you complete are imported automatically every few
						minutes.
					</p>
					<TrainingTimezoneField />
					<label className="flex items-center gap-2 text-xs text-[#94a3b8]">
						<input
							type="checkbox"
							checked={backfill}
							onChange={(e) => setBackfill(e.target.checked)}
							className="accent-[#0ea5e9]"
						/>
						Also import the last 90 days of rides (runs in the background)
					</label>
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
							className="px-3 py-2 text-xs bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
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
									? "Importing the last 90 days…"
									: "90-day import finished."}{" "}
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
