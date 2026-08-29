import { useState, useEffect } from "react";
import {
	Loader2,
	Link2,
	Link2Off,
	CheckCircle2,
	AlertCircle,
	CalendarDays,
	ExternalLink,
} from "lucide-react";
import {
	fetchGoogleCalendarStatus,
	disconnectGoogleCalendar,
	connectGoogleCalendar,
	updateCalendarTimezone,
} from "../lib/api";
import type { GoogleCalendarStatus } from "@fit-analyzer/shared";
import { AnimatedButton } from "./AnimatedButton";

/**
 * Calendar connection card. Connect captures the browser timezone, the
 * callback creates the dedicated Training calendar, and the coach schedules
 * from there — no manual sync buttons.
 */
export function GoogleCalendarConnect() {
	const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [disconnecting, setDisconnecting] = useState(false);
	const [tzSaving, setTzSaving] = useState(false);
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

	const handleTimezoneChange = async (timezone: string) => {
		const previous = status?.timezone ?? null;
		if (previous === timezone) return;
		// Optimistic update; revert on failure.
		if (status) setStatus({ ...status, timezone });
		setTzSaving(true);
		try {
			await updateCalendarTimezone(timezone);
		} catch (err) {
			if (status) setStatus({ ...status, timezone: previous });
			setNotification({
				type: "error",
				message: (err as Error).message ?? "Failed to update timezone.",
			});
		} finally {
			setTzSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-4">
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

			<div className="p-5 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.15)] rounded-xl flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#4285f4]/10 shrink-0">
						<svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
							<title>Google Calendar</title>
							<path
								fill="#4285f4"
								d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V9h14v10zm0-12H5V5h14v2z"
							/>
						</svg>
					</div>
					<div>
						<p className="text-sm font-semibold text-[#f1f5f9]">
							Google Calendar
						</p>
						<p className="text-xs text-[#94a3b8]">
							{loading
								? "Checking connection…"
								: status?.connected
									? "Connected · Training calendar"
									: "Not connected"}
						</p>
					</div>
					{loading && (
						<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
					)}
				</div>

				{!loading &&
					(!status?.connected ? (
						<>
							<p className="text-xs text-[#94a3b8]">
								Let the coach schedule your planned workouts on a dedicated
								"Training" calendar in your Google account. Google will show an
								unverified-app warning — choose "Advanced → Go to fit-analyzer"
								to continue.
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
									Planned workouts land on your Training calendar — events the
									coach adds are yours to move or edit.
								</span>
							</div>

							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="calendar-timezone"
									className="text-xs font-medium text-[#f1f5f9]"
								>
									Training timezone
								</label>
								<div className="flex items-center gap-2">
									<input
										id="calendar-timezone"
										list="iana-timezones"
										value={status.timezone ?? ""}
										onChange={(e) => handleTimezoneChange(e.target.value)}
										spellCheck={false}
										className="flex-1 px-3 py-2 text-xs bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
									/>
									{tzSaving && (
										<Loader2 className="w-3.5 h-3.5 text-[#8b5cf6] animate-spin shrink-0" />
									)}
								</div>
								<datalist id="iana-timezones">
									{Intl.supportedValuesOf("timeZone").map((tz) => (
										<option key={tz} value={tz} />
									))}
								</datalist>
							</div>

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
			</div>
		</div>
	);
}
