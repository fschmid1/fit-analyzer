import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchTrainingTimezone, updateCalendarTimezone } from "../lib/api";

/**
 * The athlete's training timezone. One value for the whole app: it places
 * planned workouts, defines the Plan week and drives the weekly refresh, on
 * whichever plan target is connected (ADR-0005).
 *
 * Edits are committed on blur/Enter, not per keystroke — a partially typed zone
 * is not a valid IANA name and would be rejected on every character.
 *
 * This field is mounted in more than one integration card, so its DOM ids come
 * from `useId` rather than fixed strings.
 */
export function TrainingTimezoneField() {
	const fieldId = useId();
	const listId = useId();
	const [timezone, setTimezone] = useState("");
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetchTrainingTimezone()
			.then((tz) => {
				setTimezone(tz ?? "");
				setDraft(tz ?? "");
			})
			.catch(() => setError("Failed to load timezone."));
	}, []);

	const commit = async () => {
		const next = draft.trim();
		if (next === timezone) return;
		if (next === "") {
			setDraft(timezone);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await updateCalendarTimezone(next);
			setTimezone(next);
		} catch (err) {
			setDraft(timezone);
			setError((err as Error).message || "Failed to update timezone.");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={fieldId} className="text-xs font-medium text-[#f1f5f9]">
				Training timezone
			</label>
			<div className="flex items-center gap-2">
				<input
					id={fieldId}
					list={listId}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={() => void commit()}
					onKeyDown={(e) => {
						if (e.key === "Enter") void commit();
					}}
					spellCheck={false}
					placeholder="Europe/Zurich"
					className="flex-1 px-3 py-2 text-xs bg-[#0f0b1a] border border-[rgba(139,92,246,0.2)] text-[#f1f5f9] rounded-xl focus:outline-none focus:border-[rgba(139,92,246,0.5)]"
				/>
				{saving && (
					<Loader2 className="w-3.5 h-3.5 text-[#8b5cf6] animate-spin shrink-0" />
				)}
			</div>
			<datalist id={listId}>
				{Intl.supportedValuesOf("timeZone").map((tz) => (
					<option key={tz} value={tz} />
				))}
			</datalist>
			<p className="text-[11px] text-[#7c6fa0]">
				Shared by every plan target. Planned workouts are placed in this zone.
			</p>
			{error && <p className="text-[11px] text-red-400">{error}</p>}
		</div>
	);
}
