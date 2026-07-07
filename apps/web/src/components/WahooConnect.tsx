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
	fetchWahooStatus,
	syncWahooActivities,
	disconnectWahoo,
	connectWahoo,
	registerWahooWebhook,
	unregisterWahooWebhook,
	type WahooStatus,
} from "../lib/api";
import { AnimatedButton } from "./AnimatedButton";

interface WahooConnectProps {
	onSynced?: () => void;
}

type DaysBack = 1 | 7 | 30 | 90 | "all";

export function WahooConnect({ onSynced }: WahooConnectProps) {
	const [status, setStatus] = useState<WahooStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const [webhookLoading, setWebhookLoading] = useState(false);
	const [webhookRegistered, setWebhookRegistered] = useState<boolean | null>(
		null,
	);
	const [daysBack, setDaysBack] = useState<DaysBack>("all");
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	// Load status on mount + handle redirect params
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const wahooParam = params.get("wahoo");

		if (wahooParam === "connected") {
			setNotification({
				type: "success",
				message: "Wahoo connected successfully!",
			});
			const url = new URL(window.location.href);
			url.searchParams.delete("wahoo");
			window.history.replaceState({}, "", url.toString());
		} else if (wahooParam === "error") {
			setNotification({
				type: "error",
				message: "Wahoo authorization failed. Please try again.",
			});
			const url = new URL(window.location.href);
			url.searchParams.delete("wahoo");
			window.history.replaceState({}, "", url.toString());
		}

		fetchWahooStatus()
			.then((s) => {
				setStatus(s);
				if (s.connected) setWebhookRegistered(s.webhookEnabled === true);
			})
			.finally(() => setLoading(false));
	}, []);

	// Auto-dismiss notifications after 5s
	useEffect(() => {
		if (!notification) return;
		const id = setTimeout(() => setNotification(null), 5000);
		return () => clearTimeout(id);
	}, [notification]);

	const handleConnect = () => {
		connectWahoo();
	};

	const handleSync = async () => {
		setSyncing(true);
		setNotification(null);
		try {
			const result = await syncWahooActivities(daysBack);
			const parts: string[] = [];
			if (result.imported > 0) parts.push(`${result.imported} imported`);
			if (result.updated > 0) parts.push(`${result.updated} updated`);
			if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
			setNotification({
				type: "success",
				message: parts.length > 0 ? parts.join(", ") : "No new rides found",
			});
			if (result.imported > 0 || result.updated > 0) onSynced?.();
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
			await disconnectWahoo();
			setStatus({ connected: false });
			setWebhookRegistered(null);
			setNotification({ type: "success", message: "Wahoo disconnected." });
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
			await registerWahooWebhook();
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
			await unregisterWahooWebhook();
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
					{/* Wahoo logo-ish icon */}
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#1ba9d5]/10 shrink-0">
						<svg
							viewBox="0 0 24 24"
							className="w-5 h-5 fill-[#1ba9d5]"
							aria-hidden="true"
						>
							<title>Wahoo</title>
							<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-3-11.5l-2 5.5-2-5.5h-2l3 7h2l3-7h-2zm8 0h-4v7h2v-2.5h2c1.1 0 2-.9 2-2v-.5c0-1.1-.9-2-2-2zm0 2.5h-2v-1h2v1z" />
						</svg>
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">Wahoo</p>
						<p className="text-xs text-[#94a3b8]">
							{loading
								? "Checking connection…"
								: status?.connected
									? `Connected · User #${status.wahooUserId}`
									: "Not connected"}
						</p>
					</div>

					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{/* Actions */}
				{!loading &&
					(!status?.connected ? (
						<AnimatedButton
							onClick={handleConnect}
							className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-[#1ba9d5] hover:bg-[#1899bf] rounded-xl transition-colors duration-200 cursor-pointer"
						>
							<Link2 className="w-4 h-4" />
							Connect with Wahoo
						</AnimatedButton>
					) : (
						<div className="flex flex-col gap-3">
							{/* Sync controls */}
							<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
								<select
									value={daysBack}
									onChange={(e) => {
										const val = e.target.value;
										setDaysBack(
											val === "all" ? "all" : (Number(val) as DaysBack),
										);
									}}
									className="px-3 py-2 text-sm bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)] cursor-pointer"
									disabled={syncing}
								>
									<option value={1}>Last day</option>
									<option value={7}>Last 7 days</option>
									<option value={30}>Last 30 days</option>
									<option value={90}>Last 90 days</option>
									<option value="all">All time</option>
								</select>

								<AnimatedButton
									onClick={handleSync}
									disabled={syncing}
									className="flex items-center gap-2 justify-center px-4 py-2 text-sm font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[#8b5cf6]/20 hover:border-[#8b5cf6]/40 rounded-xl transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
								</AnimatedButton>
							</div>

							<p className="text-xs text-[#94a3b8]">
								Syncs biking workouts (road, indoor, trainer, virtual, e-bike).
								Previously synced rides are updated with the latest data.
							</p>

							{/* Webhook auto-sync */}
							<div className="pt-2 border-t border-[rgba(139,92,246,0.1)] flex flex-col gap-2">
								<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
									<div>
										<p className="text-xs font-medium text-[#f1f5f9]">
											Auto-sync new rides
										</p>
										<p className="text-xs text-[#94a3b8] mt-0.5">
											{webhookRegistered
												? "Active — new rides are imported automatically."
												: "Register a webhook to import rides the moment they sync to the Wahoo cloud."}
										</p>
									</div>
									<AnimatedButton
										onClick={
											webhookRegistered
												? handleUnregisterWebhook
												: handleRegisterWebhook
										}
										disabled={webhookLoading}
										className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-[color,background-color,border-color] duration-200 cursor-pointer disabled:opacity-50 shrink-0 sm:ml-3 ${
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
									</AnimatedButton>
								</div>
							</div>

							{/* Disconnect */}
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
									Disconnect Wahoo
								</AnimatedButton>
							</div>
						</div>
					))}
			</div>
		</div>
	);
}
