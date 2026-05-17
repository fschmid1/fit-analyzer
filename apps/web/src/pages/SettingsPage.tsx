import { StravaConnect } from "../components/StravaConnect";
import { WaxedChainReminderSettings } from "../components/WaxedChainReminderSettings";
import { CoachModelSettings } from "../components/CoachModelSettings";
import { OpenwearablesSettings } from "../components/OpenwearablesSettings";
import type { UserInfo } from "../lib/api";

interface SettingsPageProps {
	user?: UserInfo | null;
	onActivitiesChanged?: () => void;
}

export function SettingsPage({ onActivitiesChanged }: SettingsPageProps) {
	return (
		<div className="flex-1 overflow-y-auto p-6 animate-[fadeIn_0.4s_ease-out]">
			<div className="max-w-6xl">
				<h2 className="text-2xl font-bold text-[#f1f5f9] mb-1">Settings</h2>
				<p className="text-sm text-[#94a3b8] mb-6">
					Manage integrations and preferences
				</p>

				<div className="grid gap-8 xl:grid-cols-2 xl:items-start">
					<section className="flex flex-col gap-6">
						<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
							Integrations
						</h3>
						<StravaConnect onSynced={onActivitiesChanged} />
						<OpenwearablesSettings />
					</section>

					<section>
						<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
							Maintenance
						</h3>
						<WaxedChainReminderSettings />
					</section>

					<section className="xl:col-span-2">
						<h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
							Trainer
						</h3>
						<CoachModelSettings />
					</section>
				</div>
			</div>
		</div>
	);
}
