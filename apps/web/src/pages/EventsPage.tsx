import type { StravaClubEvent } from "@fit-analyzer/shared";
import {
	AlertCircle,
	Bike,
	Calendar,
	ChevronDown,
	Clock,
	Download,
	Dumbbell,
	Footprints,
	Loader2,
	Map as MapIcon,
	MapPin,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EventRouteMap } from "../components/EventRouteMap";
import { fetchRouteGpx, fetchStravaEvents } from "../lib/api";

function formatEventDate(dateStr: string): string {
	const d = new Date(dateStr);
	return d.toLocaleDateString("en-US", {
		weekday: "long",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function SportIcon({ sportType }: { sportType: string }) {
	const lower = (sportType ?? "").toLowerCase();
	const iconClass = "w-5 h-5 text-[#8b5cf6]";
	if (
		lower.includes("ride") ||
		lower.includes("cycling") ||
		lower.includes("gravel") ||
		lower.includes("mountain") ||
		lower.includes("bike")
	) {
		return <Bike className={iconClass} />;
	}
	if (lower.includes("run")) {
		return <Footprints className={iconClass} />;
	}
	if (
		lower.includes("workout") ||
		lower.includes("gym") ||
		lower.includes("strength")
	) {
		return <Dumbbell className={iconClass} />;
	}
	return <Calendar className={iconClass} />;
}

interface EventCardProps {
	event: StravaClubEvent;
}

function EventCard({ event }: EventCardProps) {
	const dates = event.upcomingOccurrences;
	const primaryDate = dates.length > 0 ? dates[0] : null;
	const [routeExpanded, setRouteExpanded] = useState(false);
	const [routeCoords, setRouteCoords] = useState<
		([number, number] | [number, number, number])[] | null
	>(null);
	const [routeGpx, setRouteGpx] = useState<string | null>(null);
	const [routeLoading, setRouteLoading] = useState(false);
	const [routeError, setRouteError] = useState(false);

	const toggleRoute = useCallback(async () => {
		if (routeExpanded) {
			setRouteExpanded(false);
			return;
		}
		setRouteExpanded(true);
		if (routeCoords || routeError) return;
		if (!event.route) return;
		setRouteLoading(true);
		setRouteError(false);
		try {
			const result = await fetchRouteGpx(event.route.id);
			setRouteCoords(result.coordinates);
			setRouteGpx(result.gpx);
		} catch {
			setRouteError(true);
		} finally {
			setRouteLoading(false);
		}
	}, [routeExpanded, routeCoords, routeError, event.route]);

	const downloadGpx = useCallback(() => {
		if (!routeGpx || !event.route) return;
		const blob = new Blob([routeGpx], { type: "application/gpx+xml" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${event.route.name.replace(/\s+/g, "_")}.gpx`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}, [routeGpx, event.route]);

	return (
		<div className="bg-[#1a1533]/70 border border-[rgba(139,92,246,0.1)] rounded-xl p-4 sm:p-5 hover:border-[rgba(139,92,246,0.25)] transition-colors duration-200">
			<div className="flex items-start gap-3">
				<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#8b5cf6]/15 shrink-0">
					<SportIcon sportType={event.sportType} />
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="text-sm sm:text-base font-semibold text-[#f1f5f9] leading-snug">
						{event.title}
					</h3>
					<div className="flex items-center gap-2 mt-1">
						<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-[#8b5cf6]/15 text-[#c4b5fd] border border-[#8b5cf6]/10">
							{event.clubName}
						</span>
						<span className="text-xs text-[#94a3b8] capitalize">
							{event.sportType}
						</span>
					</div>
				</div>
			</div>

			<div className="mt-4 space-y-2">
				{primaryDate && (
					<div className="flex items-center gap-2 text-sm text-[#94a3b8]">
						<Calendar className="w-4 h-4 text-[#8b5cf6]/60 shrink-0" />
						<span className="text-[#f1f5f9]">
							{formatEventDate(primaryDate)}
						</span>
					</div>
				)}

				{dates.length > 1 && (
					<div className="ml-6 space-y-1">
						{dates.slice(1, 5).map((d, i) => (
							<div
								key={d}
								className="text-xs text-[#94a3b8] flex items-center gap-2"
							>
								<Clock className="w-3 h-3" />
								<span>{formatEventDate(d)}</span>
								{i === 3 && dates.length > 5 && (
									<span className="text-[#8b5cf6]">
										+{dates.length - 5} more
									</span>
								)}
							</div>
						))}
					</div>
				)}

				<div className="flex flex-wrap items-center gap-3 text-xs text-[#94a3b8]">
					{event.address && (
						<div className="flex items-center gap-1">
							<MapPin className="w-3.5 h-3.5 text-[#8b5cf6]/60" />
							<span>{event.address}</span>
						</div>
					)}
					{event.participantCount != null && (
						<div className="flex items-center gap-1">
							<Users className="w-3.5 h-3.5 text-[#8b5cf6]/60" />
							<span>
								{event.participantCount}{" "}
								{event.participantCount === 1 ? "participant" : "participants"}
							</span>
						</div>
					)}
					{event.organizer && (
						<div className="text-[#8b5cf6]/60">by {event.organizer.name}</div>
					)}
				</div>

				{event.city && (
					<div className="text-xs text-[#8b5cf6]/50">
						{event.city}
						{event.state ? `, ${event.state}` : ""}
					</div>
				)}

				{event.route && (
					<>
						<div className="mt-3 rounded-lg border border-[rgba(139,92,246,0.1)] overflow-hidden">
							<button
								type="button"
								onClick={toggleRoute}
								className="w-full flex items-center justify-between px-3 py-2.5 bg-[#1a1533] hover:bg-[#241e3d] transition-colors"
							>
								<div className="flex items-center gap-2 min-w-0">
									<MapIcon size={14} stroke="#8b5cf6" />
									<span className="text-xs font-medium text-[#f1f5f9] truncate">
										{event.route.name}
									</span>
								</div>
								<ChevronDown
									size={16}
									className={`text-[#94a3b8] shrink-0 transition-transform duration-200 ${routeExpanded ? "rotate-180" : ""}`}
								/>
							</button>
							{routeExpanded && routeLoading && (
								<div className="flex items-center justify-center py-6">
									<Loader2 className="w-5 h-5 animate-spin text-[#8b5cf6]" />
								</div>
							)}
							{routeExpanded && routeError && (
								<div className="text-xs text-[#94a3b8] text-center py-4">
									Failed to load route
								</div>
							)}
							{routeExpanded && !routeLoading && !routeError && routeCoords && (
								<EventRouteMap coordinates={routeCoords} />
							)}
							{routeExpanded &&
								!routeLoading &&
								!routeError &&
								!routeCoords && (
									<div className="text-xs text-[#94a3b8] text-center py-4">
										No route map available
									</div>
								)}
						</div>
						{routeGpx && (
							<button
								type="button"
								onClick={downloadGpx}
								className="mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium text-[#c4b5fd] bg-[#8b5cf6]/10 hover:bg-[#8b5cf6]/20 border border-[rgba(139,92,246,0.1)] transition-colors"
								title="Download GPX"
							>
								<Download size={12} />
								Download GPX
							</button>
						)}
					</>
				)}
			</div>
		</div>
	);
}

export function EventsPage() {
	const [events, setEvents] = useState<StravaClubEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await fetchStravaEvents();
			setEvents(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load events");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const upcoming = events.filter((e) => !e.isPast);
	const past = events.filter((e) => e.isPast);

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center overflow-hidden">
				<div className="flex flex-col items-center gap-4 text-[#94a3b8]">
					<Loader2 className="w-8 h-8 animate-spin text-[#8b5cf6]" />
					<p className="text-sm">Loading events...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center overflow-hidden p-4">
				<div className="flex flex-col items-center gap-3 text-center max-w-md">
					<AlertCircle className="w-8 h-8 text-red-400" />
					<p className="text-sm text-[#94a3b8]">{error}</p>
				</div>
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center overflow-hidden p-4">
				<div className="flex flex-col items-center gap-3 text-center max-w-md">
					<Calendar className="w-12 h-12 text-[#8b5cf6]/30" />
					<p className="text-sm text-[#94a3b8]">
						No club events found. Connect Strava and join some clubs to see
						events here.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto">
			<div className="max-w-3xl mx-auto px-3 py-4 sm:px-6 sm:py-6 space-y-8">
				{upcoming.length > 0 && (
					<section>
						<h2 className="text-sm font-semibold text-[#8b5cf6] uppercase tracking-wide mb-4">
							<Calendar className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
							Upcoming Events ({upcoming.length})
						</h2>
						<div className="space-y-3">
							{upcoming.map((event) => (
								<EventCard key={event.id} event={event} />
							))}
						</div>
					</section>
				)}

				{past.length > 0 && (
					<section>
						<h2 className="text-sm font-semibold text-[#8b5cf6]/60 uppercase tracking-wide mb-4">
							<Clock className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
							Past Events ({past.length})
						</h2>
						<div className="space-y-3">
							{past.map((event) => (
								<EventCard key={event.id} event={event} />
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
