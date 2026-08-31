import { Loader2 } from "lucide-react";
import { useEmbeddedSettings } from "../pages/settings/settingsShared";

interface ConnectCardProps {
	title: string;
	/** Brand color for the icon chip. */
	accent: string;
	icon: React.ReactNode;
	/** null while loading, otherwise whether the service is connected. */
	connected: boolean | null;
	statusText: string;
	loading?: boolean;
	children?: React.ReactNode;
}

/**
 * Card chrome for a connect-style integration. Shows brand icon, title and
 * live status; inside a settings layout variant the page provides the
 * container and this renders only the header row.
 */
export function ConnectCard({
	title,
	accent,
	icon,
	connected,
	statusText,
	loading,
	children,
}: ConnectCardProps) {
	const embedded = useEmbeddedSettings();
	const header = (
		<div className="flex items-center gap-3">
			<div
				className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
				style={{ backgroundColor: `${accent}1a` }}
			>
				{icon}
			</div>
			<div className="min-w-0">
				<p className="text-sm font-semibold text-[#f1f5f9]">{title}</p>
				<p className="text-xs text-[#94a3b8] truncate">{statusText}</p>
			</div>
			{connected !== null &&
				(embedded ? (
					<span
						className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
							connected
								? "text-emerald-300 bg-emerald-500/10"
								: "text-[#94a3b8] bg-white/5"
						}`}
					>
						<span
							aria-hidden="true"
							className={`w-1.5 h-1.5 rounded-full ${
								connected ? "bg-emerald-400" : "bg-current opacity-60"
							}`}
						/>
						{connected ? "On" : "Off"}
					</span>
				) : null)}
			{loading && (
				<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
			)}
		</div>
	);

	if (embedded) {
		// The variant layout supplies title, status and container; render
		// controls only to avoid duplicate headers.
		return <>{children}</>;
	}

	return (
		<div className="p-5 bg-[#1a1533]/70 border border-[rgba(139,92,246,0.15)] rounded-xl flex flex-col gap-4">
			{header}
			{children}
		</div>
	);
}
