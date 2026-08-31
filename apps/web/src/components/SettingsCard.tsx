import { Loader2 } from "lucide-react";
import { useEmbeddedSettings } from "../pages/settings/settingsShared";

interface SettingsCardProps {
	icon: React.ReactNode;
	title: string;
	subtitle: string;
	loading?: boolean;
	children?: React.ReactNode;
}

/**
 * Card chrome for a settings domain. Inside a settings layout variant the
 * page provides the container, so this renders only the header row.
 */
export function SettingsCard({
	icon,
	title,
	subtitle,
	loading,
	children,
}: SettingsCardProps) {
	const embedded = useEmbeddedSettings();
	const header = (
		<div className="flex items-center gap-3">
			<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#8b5cf6]/10 shrink-0">
				{icon}
			</div>
			<div>
				<p className="text-sm font-semibold text-[#f1f5f9]">{title}</p>
				<p className="text-xs text-[#94a3b8]">{subtitle}</p>
			</div>
			{loading && (
				<Loader2 className="w-4 h-4 text-[#8b5cf6] animate-spin ml-auto" />
			)}
		</div>
	);

	if (embedded) {
		// The variant layout supplies title, blurb and container; render
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
