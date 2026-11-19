import { useState, useEffect } from "react";
import {
	Loader2,
	Link2,
	Link2Off,
	CalendarDays,
	ExternalLink,
} from "lucide-react";
import {
	fetchGoogleCalendarStatus,
	disconnectGoogleCalendar,
	connectGoogleCalendar,
} from "../lib/api";
import type { GoogleCalendarStatus } from "@fit-analyzer/shared";
import { AnimatedButton } from "./AnimatedButton";
import { ConnectCard } from "./ConnectCard";
import { SettingsBanner } from "../pages/settings/settingsShared";
import { TrainingTimezoneField } from "./TrainingTimezoneField";

/**
 * Training calendar connection card. Connect captures the browser timezone and
 * the callback creates the dedicated Training calendar. This is a Plan target:
 * the plan of record on its own, or a projection of the intervals.icu plan when
 * both are connected (ADR-0005).
 */
export function GoogleCalendarConnect() {
	const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [disconnecting, setDisconnecting] = useState(false);
	const [notification, setNotification] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const googleParam = params.get("google");

		if (googleParam === "connected") {
			setNotification({
				type: "success",
				message: "Google Calendar connected — Training calendar ready.",
			});
		} else if (googleParam === "error") {
			setNotification({
				type: "error",
				message: "Google authorization failed. Please try again.",
			});
		}
		if (googleParam === "connected" || googleParam === "error") {
			const url = new URL(window.location.href);
			url.searchParams.delete("google");
			window.history.replaceState({}, "", url.toString());
		}

		fetchGoogleCalendarStatus()
			.then(setStatus)
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!notification) return;
		const id = setTimeout(() => setNotification(null), 5000);
		return () => clearTimeout(id);
	}, [notification]);

	const handleConnect = () => {
		connectGoogleCalendar();
	};

	const handleDisconnect = async () => {
		setDisconnecting(true);
		try {
			await disconnectGoogleCalendar();
			setStatus({
				connected: false,
				calendarId: null,
				timezone: null,
				calendarUrl: null,
			});
			setNotification({
				type: "success",
				message:
					"Disconnected. Your Training calendar and its events were left in place.",
			});
		} catch {
			setNotification({ type: "error", message: "Failed to disconnect." });
		} finally {
			setDisconnecting(false);
		}
	};

	return (
		<ConnectCard
			title="Google Calendar"
			accent="#4285f4"
			loading={loading}
			connected={status?.connected ?? null}
			statusText={
				loading
					? "Checking connection…"
					: status?.connected
						? "Connected · Training calendar"
						: "Not connected"
			}
			icon={
				<svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
					<title>Google Calendar</title>
					<path
						fill="#4285f4"
						d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V9h14v10zm0-12H5V5h14v2z"
					/>
				</svg>
			}
		>
			{notification && <SettingsBanner notification={notification} />}
			{!loading &&
				(!status?.connected ? (
					<>
						<p className="text-xs text-[#94a3b8]">
							Let the coach schedule your planned workouts on a dedicated
							"Training" calendar in your Google account. Google will show an
							unverified-app warning — choose "Advanced → Go to fit-analyzer" to
							continue.
						</p>
						<AnimatedButton
							onClick={handleConnect}
							className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white bg-[#4285f4] hover:bg-[#3367d6] rounded-xl transition-colors duration-200 cursor-pointer"
						>
							<Link2 className="w-4 h-4" />
							Connect Google Calendar
						</AnimatedButton>
					</>
				) : (
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2 text-xs text-[#94a3b8]">
							<CalendarDays className="w-3.5 h-3.5 shrink-0" />
							<span>
								Planned workouts land on your Training calendar. If
								intervals.icu is also connected it is the plan of record, and
								this calendar is refreshed from it.
							</span>
						</div>

						<TrainingTimezoneField />

						{status.calendarUrl && (
							<a
								href={status.calendarUrl}
								target="_blank"
								rel="noreferrer"
								className="flex items-center gap-1.5 text-xs text-[#c4b5fd] hover:text-[#a78bfa] transition-colors duration-200 w-fit"
							>
								<ExternalLink className="w-3.5 h-3.5" />
								Open Training calendar
							</a>
						)}

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
				))}
		</ConnectCard>
	);
}
