import { AthleteProfileSettings } from "../components/AthleteProfileSettings";
import { CoachModelSettings } from "../components/CoachModelSettings";
import { GoogleCalendarConnect } from "../components/GoogleCalendarConnect";
import { HealthAutoExportSettings } from "../components/HealthAutoExportSettings";
import { OpenwearablesSettings } from "../components/OpenwearablesSettings";
import { PlanRefreshSettingsCard } from "../components/PlanRefreshSettingsCard";
import { ProfileChangelogCard } from "../components/ProfileChangelogCard";
import { StravaConnect } from "../components/StravaConnect";
import { WahooConnect } from "../components/WahooConnect";
import { WaxedChainReminderSettings } from "../components/WaxedChainReminderSettings";
import { ZoneOverrideSettings } from "../components/ZoneOverrideSettings";
import { IntegrationsStatusProvider } from "./settings/integrationsStatus";
import { EmbeddedSettingsProvider } from "./settings/settingsShared";
import { BoardVariant } from "./settings/BoardVariant";
import { HeadUnitVariant } from "./settings/HeadUnitVariant";

/** Map a settings domain id to its control body. */
function DomainBody({
	id,
	onSynced,
}: {
	id: string;
	onSynced?: () => void;
}) {
	switch (id) {
		case "strava":
			return <StravaConnect onSynced={onSynced} />;
		case "wahoo":
			return <WahooConnect onSynced={onSynced} />;
		case "calendar":
			return <GoogleCalendarConnect />;
		case "openwearables":
			return <OpenwearablesSettings />;
		case "hae":
			return <HealthAutoExportSettings />;
		case "profile":
			return <AthleteProfileSettings />;
		case "zones":
			return <ZoneOverrideSettings />;
		case "coachModel":
			return <CoachModelSettings />;
		case "planRefresh":
			return <PlanRefreshSettingsCard />;
		case "waxed":
			return <WaxedChainReminderSettings />;
		case "changelog":
			return <ProfileChangelogCard />;
		default:
			return null;
	}
}

function SettingsPageInner({
	onActivitiesChanged,
}: {
	onActivitiesChanged?: () => void;
}) {
	const renderDomain = (id: string): React.ReactNode => (
		<DomainBody id={id} onSynced={onActivitiesChanged} />
	);

	return (
		<div className="flex-1 overflow-y-auto p-3 animate-[fadeIn_0.4s_ease-out]">
			<div className="max-w-full mx-2 sm:mx-4 lg:mx-6">
				<h2 className="text-2xl font-bold text-[#f1f5f9] mb-1">Settings</h2>
				<p className="text-sm text-[#94a3b8] mb-3">
					Manage integrations and preferences
				</p>
				{/* Mobile: flat status rows; desktop: head-unit rail + pane */}
				<BoardVariant renderDomain={renderDomain} />
				<HeadUnitVariant renderDomain={renderDomain} />
			</div>
		</div>
	);
}

export function SettingsPage({
	onActivitiesChanged,
}: {
	user?: unknown;
	onActivitiesChanged?: () => void;
}) {
	return (
		<IntegrationsStatusProvider>
			<EmbeddedSettingsProvider value>
				<SettingsPageInner onActivitiesChanged={onActivitiesChanged} />
			</EmbeddedSettingsProvider>
		</IntegrationsStatusProvider>
	);
}
