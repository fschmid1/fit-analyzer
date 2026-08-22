/**
 * Profile/zones invalidation store — same-tab pub/sub + cross-tab broadcast.
 *
 * When the trainer updates the profile (update_profile, set_zones, reset_zones)
 * or the user edits the settings page, `notifyProfileChanged()` fires. Mounted
 * consumers (ZonesCard, lifted SettingsProvider) subscribe and refetch so they
 * never show stale data after a trainer-originated write.
 *
 * Cross-tab invalidation uses BroadcastChannel (with a localStorage fallback)
 * so a trainer update in one tab invalidates the Stats page in another tab.
 */

type Listener = () => void;

const CHANNEL_NAME = "fit-analyzer:profile";
const STORAGE_KEY = "fit-analyzer:profile-version";

let listeners: Listener[] = [];
let channel: BroadcastChannel | null = null;

try {
	channel = new BroadcastChannel(CHANNEL_NAME);
	channel.onmessage = () => {
		for (const fn of listeners) fn();
	};
} catch {
	channel = null;
}

// storage-event fallback for browsers without BroadcastChannel
if (typeof window !== "undefined" && !channel) {
	window.addEventListener("storage", (e) => {
		if (e.key === STORAGE_KEY) {
			for (const fn of listeners) fn();
		}
	});
}

export function notifyProfileChanged(): void {
	if (channel) {
		try {
			channel.postMessage({ ts: Date.now() });
		} catch {
			/* channel closed — same-tab listeners still fire below */
		}
	} else if (typeof window !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, String(Date.now()));
		} catch {
			/* ignore quota errors */
		}
	}
	for (const fn of listeners) fn();
}

export function subscribeProfileChanged(fn: Listener): () => void {
	listeners.push(fn);
	return () => {
		listeners = listeners.filter((l) => l !== fn);
	};
}
