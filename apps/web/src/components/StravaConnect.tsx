import { useState, useEffect } from "react";
import {
	Loader2,
	Link2,
	Link2Off,
	RefreshCw,
	CheckCircle2,
	AlertCircle,
	Webhook,
	WebhookOff,
} from "lucide-react";
import {
	fetchStravaStatus,
	syncStravaActivities,
	disconnectStrava,
	connectStrava,
	registerStravaWebhook,
	unregisterStravaWebhook,
	type StravaStatus,
} from "../lib/api";

interface StravaConnectProps {
	onSynced?: () => void;
}

type DaysBack = 7 | 30 | 90;

export function StravaConnect({ onSynced }: StravaConnectProps) {
	const [status, setStatus] = useState<StravaStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const [webhookLoading, setWebhookLoading] = useState(false);
	const [webhookRegistered, setWebhookRegistered] = useState<boolean | null>(
		null,
	);
	const [daysBack, setDaysBack] = useState<DaysBack>(30);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	// Load status on mount + handle redirect params
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const stravaParam = params.get("strava");

		if (stravaParam === "connected") {
			setNotification({
				type: "success",
				message: "Strava connected successfully!",
			});
			// Clean the URL without reloading
			const url = new URL(window.location.href);
			url.searchParams.delete("strava");
			window.history.replaceState({}, "", url.toString());
		} else if (stravaParam === "error") {
			setNotification({
				type: "error",
				message: "Strava authorization failed. Please try again.",
			});
			const url = new URL(window.location.href);
			url.searchParams.delete("strava");
			window.history.replaceState({}, "", url.toString());
		}

		fetchStravaStatus()
			.then(setStatus)
			.finally(() => setLoading(false));
	}, []);

	// Auto-dismiss notifications after 5s
	useEffect(() => {
		if (!notification) return;
		const id = setTimeout(() => setNotification(null), 5000);
		return () => clearTimeout(id);
	}, [notification]);

	const handleConnect = () => {
		connectStrava();
	};

	const handleSync = async () => {
		setSyncing(true);
		setNotification(null);
		try {
			const result = await syncStravaActivities(daysBack);
			const parts: string[] = [];
			if (result.imported > 0) parts.push(`${result.imported} imported`);
			if (result.skipped > 0) parts.push(`${result.skipped} already synced`);
			setNotification({
				type: "success",
				message: parts.length > 0 ? parts.join(", ") : "No new rides found",
			});
			if (result.imported > 0) onSynced?.();
		} catch (err) {
			setNotification({
				type: "error",
				message: (err as Error).message ?? "Sync failed",
			});
		} finally {
			setSyncing(false);
		}
	};

	const handleDisconnect = async () => {
		setDisconnecting(true);
		try {
			await disconnectStrava();
			setStatus({ connected: false });
			setWebhookRegistered(null);
			setNotification({ type: "success", message: "Strava disconnected." });
		} catch {
			setNotification({ type: "error", message: "Failed to disconnect." });
		} finally {
			setDisconnecting(false);
		}
	};

	const handleRegisterWebhook = async () => {
		setWebhookLoading(true);
		setNotification(null);
		try {
			await registerStravaWebhook();
			setWebhookRegistered(true);
			setNotification({
				type: "success",
				message: "Webhook registered — new rides will sync automatically.",
			});
		} catch (err) {
			setNotification({ type: "error", message: (err as Error).message });
		} finally {
			setWebhookLoading(false);
		}
	};

	const handleUnregisterWebhook = async () => {
		setWebhookLoading(true);
		setNotification(null);
		try {
			await unregisterStravaWebhook();
			setWebhookRegistered(false);
			setNotification({ type: "success", message: "Webhook removed." });
		} catch (err) {
			setNotification({ type: "error", message: (err as Error).message });
		} finally {
			setWebhookLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Notification banner */}
			{notification && (
				<div
					className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
						notification.type === "success"
							? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
							: "bg-red-500/10 border border-red-500/20 text-red-400"
					}`}
				>
					{notification.type === "success" ? (
						<CheckCircle2 className="w-4 h-4 shrink-0" />
					) : (
						<AlertCircle className="w-4 h-4 shrink-0" />
					)}
					{notification.message}
				</div>
			)}

			{/* Main card */}
			<div className="p-5 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.15)] rounded-xl flex flex-col gap-4">
				{/* Header row */}
				<div className="flex items-center gap-3">
					{/* Strava logo-ish icon */}
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#fc4c02]/10 shrink-0">
						<svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#fc4c02]">
							<path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
						</svg>
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">Strava</p>
						<p className="text-xs text-[#94a3b8]">
							{loading
								? "Checking connection…"
								: status?.connected
									? `Connected · Athlete #${status.athleteId}`
									: "Not connected"}
						</p>
					</div>

					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{/* Actions */}
				{!loading && (
					<>
						{!status?.connected ? (
							<button
								onClick={handleConnect}
								className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-[#fc4c02] hover:bg-[#e04400] rounded-xl transition-colors duration-200 cursor-pointer"
							>
								<Link2 className="w-4 h-4" />
								Connect with Strava
							</button>
						) : (
							<div className="flex flex-col gap-3">
								{/* Sync controls */}
								<div className="flex items-center gap-2">
									<select
										value={daysBack}
										onChange={(e) =>
											setDaysBack(Number(e.target.value) as DaysBack)
										}
										className="px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)] cursor-pointer"
										disabled={syncing}
									>
										<option value={7}>Last 7 days</option>
										<option value={30}>Last 30 days</option>
										<option value={90}>Last 90 days</option>
									</select>

									<button
										onClick={handleSync}
										disabled={syncing}
										className="flex items-center gap-2 flex-1 justify-center px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{syncing ? (
											<>
												<Loader2 className="w-4 h-4 animate-spin" />
												Syncing…
											</>
										) : (
											<>
												<RefreshCw className="w-4 h-4" />
												Sync Rides
											</>
										)}
									</button>
								</div>

								<p className="text-xs text-[#94a3b8]">
									Syncs Ride, VirtualRide, and EBikeRide activities.
									Already-imported rides are skipped automatically.
								</p>

								{/* Webhook auto-sync */}
								<div className="pt-2 border-t border-[rgba(139,92,246,0.1)] flex flex-col gap-2">
									<div className="flex items-center justify-between">
										<div>
											<p className="text-xs font-medium text-[#f1f5f9]">
												Auto-sync new rides
											</p>
											<p className="text-xs text-[#94a3b8] mt-0.5">
												{webhookRegistered
													? "Active — new rides are imported automatically."
													: "Register a webhook to import rides the moment you save them on Strava."}
											</p>
										</div>
										<button
											onClick={
												webhookRegistered
													? handleUnregisterWebhook
													: handleRegisterWebhook
											}
											disabled={webhookLoading}
											className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 shrink-0 ml-3 ${
												webhookRegistered
													? "text-[#94a3b8] hover:text-red-400 bg-transparent hover:bg-red-500/10"
													: "text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40"
											}`}
										>
											{webhookLoading ? (
												<Loader2 className="w-3.5 h-3.5 animate-spin" />
											) : webhookRegistered ? (
												<WebhookOff className="w-3.5 h-3.5" />
											) : (
												<Webhook className="w-3.5 h-3.5" />
											)}
											{webhookRegistered ? "Disable" : "Enable"}
										</button>
									</div>
								</div>

								{/* Disconnect */}
								<div className="pt-1 border-t border-[rgba(139,92,246,0.1)]">
									<button
										onClick={handleDisconnect}
										disabled={disconnecting}
										className="flex items-center gap-1.5 text-xs text-[#94a3b8] hover:text-red-400 transition-colors duration-200 cursor-pointer disabled:opacity-50"
									>
										{disconnecting ? (
											<Loader2 className="w-3 h-3 animate-spin" />
										) : (
											<Link2Off className="w-3 h-3" />
										)}
										Disconnect Strava
									</button>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
