import { AthleteProfileSettings } from "../components/AthleteProfileSettings";
import { CoachModelSettings } from "../components/CoachModelSettings";
import { HealthAutoExportSettings } from "../components/HealthAutoExportSettings";
import { OpenwearablesSettings } from "../components/OpenwearablesSettings";
import { StravaConnect } from "../components/StravaConnect";
import { WaxedChainReminderSettings } from "../components/WaxedChainReminderSettings";
import { SettingsProvider } from "../lib/settingsContext";
import type { UserInfo } from "../lib/api";

interface SettingsPageProps {
	user?: UserInfo | null;
	onActivitiesChanged?: () => void;
}

export function SettingsPage({ onActivitiesChanged }: SettingsPageProps) {
	return (
		<SettingsProvider preload>
			<div className="flex-1 overflow-y-auto p-3 animate-[fadeIn_0.4s_ease-out]">
				<div className="max-w-full mx-2 sm:mx-4 lg:mx-6">
					<h2 className="text-2xl font-bold text-[#f1f5f9] mb-1">Settings</h2>
					<p className="text-sm text-[#94a3b8] mb-3">
						Manage integrations and preferences
					</p>

					<div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:items-start">
						<section className="flex flex-col gap-3">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
								Integrations
							</h3>
							<StravaConnect onSynced={onActivitiesChanged} />
							<OpenwearablesSettings />
							<HealthAutoExportSettings />
						</section>

						<section className="flex flex-col gap-4">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
								Maintenance
							</h3>
							<WaxedChainReminderSettings />
						</section>

						<section className="flex flex-col gap-4">
							<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
								Trainer
							</h3>
							<AthleteProfileSettings />
							<CoachModelSettings />
						</section>
					</div>
				</div>
			</div>
		</SettingsProvider>
	);
}
