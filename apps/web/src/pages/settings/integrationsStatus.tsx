import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { GoogleCalendarStatus, HealthSource } from "@fit-analyzer/shared";
import {
	fetchGoogleCalendarStatus,
	fetchHaeStatus,
	fetchStravaStatus,
	fetchWahooStatus,
	type StravaStatus,
	type WahooStatus,
} from "../../lib/api";

export interface HaeStatusInfo {
	configured: boolean;
	lastSyncAt?: string | null;
	healthSource?: HealthSource;
}

export interface FlashMessage {
	id: SettingsDomainId;
	type: "success" | "error";
	message: string;
}

export type SettingsDomainId =
	| "strava"
	| "wahoo"
	| "calendar"
	| "openwearables"
	| "hae"
	| "waxed"
	| "profile"
	| "zones"
	| "coachModel"
	| "changelog";

export type LedState = "ok" | "attention" | "off" | "unknown";

interface IntegrationsStatusValue {
	ready: boolean;
	strava: StravaStatus | null;
	wahoo: WahooStatus | null;
	calendar: GoogleCalendarStatus | null;
	hae: HaeStatusInfo | null;
	flash: FlashMessage | null;
	updateStrava: (next: StravaStatus) => void;
	updateWahoo: (next: WahooStatus) => void;
	updateCalendar: (next: GoogleCalendarStatus) => void;
	updateHae: (next: HaeStatusInfo) => void;
	setFlash: (message: FlashMessage | null) => void;
}

const IntegrationsStatusContext = createContext<IntegrationsStatusValue | null>(
	null,
);

const DISMISS_MS = 5000;

/**
 * Central fetch of every integration status so page chrome (nav rails, LED
 * dots, status chips) and setting bodies read the same source without
 * refetching per card.
 */
export function IntegrationsStatusProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [ready, setReady] = useState(false);
	const [strava, setStrava] = useState<StravaStatus | null>(null);
	const [wahoo, setWahoo] = useState<WahooStatus | null>(null);
	const [calendar, setCalendar] = useState<GoogleCalendarStatus | null>(null);
	const [hae, setHae] = useState<HaeStatusInfo | null>(null);
	const [flash, setFlash] = useState<FlashMessage | null>(null);

	const stravaRef = useRef(setStrava);
	const wahooRef = useRef(setWahoo);
	const haeRef = useRef(setHae);
	const calendarRef = useRef(setCalendar);

	const updateStrava = useCallback((next: StravaStatus) => {
		stravaRef.current(next);
	}, []);
	const updateWahoo = useCallback((next: WahooStatus) => {
		wahooRef.current(next);
	}, []);
	const updateCalendar = useCallback((next: GoogleCalendarStatus) => {
		calendarRef.current(next);
	}, []);
	const updateHae = useCallback((next: HaeStatusInfo) => {
		haeRef.current(next);
	}, []);
	const setFlashMessage = useCallback((next: FlashMessage | null) => {
		setFlash(next);
	}, []);

	// Initial load: fetch every integration status once, surface redirect
	// results (?strava=connected etc.) as flash messages and clean the URL.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);

		const consume = (key: string, id: SettingsDomainId, label: string) => {
			const value = params.get(key);
			if (value !== "connected" && value !== "error") return null;
			const url = new URL(window.location.href);
			url.searchParams.delete(key);
			window.history.replaceState({}, "", url.toString());
			return {
				id,
				type: value === "connected" ? ("success" as const) : ("error" as const),
				message:
					value === "connected"
						? `${label} connected.`
						: `${label} authorization failed. Please try again.`,
			};
		};

		const flashes = [
			consume("strava", "strava", "Strava"),
			consume("wahoo", "wahoo", "Wahoo"),
			consume("google", "calendar", "Google Calendar"),
		].filter((f): f is FlashMessage => f !== null);

		if (flashes.length > 0) {
			setFlash(flashes[flashes.length - 1]);
		}

		Promise.allSettled([
			fetchStravaStatus().then(updateStrava),
			fetchWahooStatus().then(updateWahoo),
			fetchGoogleCalendarStatus().then(updateCalendar),
			fetchHaeStatus().then((s) =>
				updateHae({
					configured: s.configured,
					lastSyncAt: s.lastSyncAt ?? null,
					healthSource: s.healthSource,
				}),
			),
		]).finally(() => setReady(true));
	}, [updateStrava, updateWahoo, updateCalendar, updateHae]);

	// Auto-dismiss flash messages.
	useEffect(() => {
		if (!flash) return;
		const id = window.setTimeout(() => setFlash(null), DISMISS_MS);
		return () => window.clearTimeout(id);
	}, [flash]);

	const value = useMemo(
		() => ({
			ready,
			strava,
			wahoo,
			calendar,
			hae,
			flash,
			updateStrava,
			updateWahoo,
			updateCalendar,
			updateHae,
			setFlash: setFlashMessage,
		}),
		[
			ready,
			strava,
			wahoo,
			calendar,
			hae,
			flash,
			updateStrava,
			updateWahoo,
			updateCalendar,
			updateHae,
			setFlashMessage,
		],
	);

	return (
		<IntegrationsStatusContext.Provider value={value}>
			{children}
		</IntegrationsStatusContext.Provider>
	);
}

export function useIntegrationsStatus(): IntegrationsStatusValue {
	const ctx = useContext(IntegrationsStatusContext);
	if (!ctx) {
		throw new Error(
			"useIntegrationsStatus must be used within IntegrationsStatusProvider",
		);
	}
	return ctx;
}

/** Derive a simple LED state from whether a thing is configured/on. */
export function ledFrom(
	data: boolean | null | undefined,
	attention?: boolean,
): LedState {
	if (attention) return "attention";
	if (data === null || data === undefined) return "unknown";
	return data ? "ok" : "off";
}
