import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { UserSettingsResponse } from "../lib/api";
import { fetchUserSettings } from "../lib/api";

interface SettingsContextValue {
	data: UserSettingsResponse | null;
	loading: boolean;
	error: Error | null;
	refresh: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
	children,
	preload = false,
}: {
	children: React.ReactNode;
	preload?: boolean;
}) {
	const [data, setData] = useState<UserSettingsResponse | null>(null);
	const [loading, setLoading] = useState(preload);
	const [error, setError] = useState<Error | null>(null);

	const refresh = useCallback(() => {
		setLoading(true);
		setError(null);
		fetchUserSettings()
			.then(setData)
			.catch(setError)
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		if (!preload) return;
		refresh();
	}, [preload, refresh]);

	const value = useMemo(
		() => ({ data, loading, error, refresh }),
		[data, loading, error, refresh],
	);

	return (
		<SettingsContext.Provider value={value}>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsContextValue {
	const ctx = useContext(SettingsContext);
	if (!ctx) {
		throw new Error("useSettings must be used within a SettingsProvider");
	}
	return ctx;
}
