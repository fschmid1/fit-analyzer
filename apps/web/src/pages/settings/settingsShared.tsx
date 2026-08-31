import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export interface SettingsNotification {
	type: "success" | "error";
	message: string;
}

export const NOTIFICATION_DISMISS_MS = 5000;

const EmbeddedContext = createContext<boolean>(false);

/** Provider marking all settings cards below as embedded (no card chrome). */
export function EmbeddedSettingsProvider({
	value,
	children,
}: {
	value: boolean;
	children: React.ReactNode;
}) {
	return (
		<EmbeddedContext.Provider value={value}>
			{children}
		</EmbeddedContext.Provider>
	);
}

/** True when settings cards should render controls only, without card chrome. */
export function useEmbeddedSettings(): boolean {
	return useContext(EmbeddedContext);
}

/** Auto-dismissing success/error notification, dismisses after 5s. */
export function useAutoNotification() {
	const [notification, setNotification] = useState<SettingsNotification | null>(
		null,
	);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!notification) return;
		timeoutRef.current = setTimeout(
			() => setNotification(null),
			NOTIFICATION_DISMISS_MS,
		);
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, [notification]);

	const show = useCallback((next: SettingsNotification | null) => {
		setNotification(next);
	}, []);

	return [notification, show] as const;
}

/** Inline success/error banner shared by every variant. */
export function SettingsBanner({
	notification,
}: {
	notification: SettingsNotification | null;
}) {
	if (!notification) return null;
	return (
		<output
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
		</output>
	);
}
