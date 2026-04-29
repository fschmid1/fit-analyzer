import { StravaConnect } from "../components/StravaConnect";
import { WaxedChainReminderSettings } from "../components/WaxedChainReminderSettings";
import type { UserInfo } from "../lib/api";

interface SettingsPageProps {
  user?: UserInfo | null;
  onActivitiesChanged?: () => void;
}

export function SettingsPage({ onActivitiesChanged }: SettingsPageProps) {
  return (
    <div className="flex-1 p-6 animate-[fadeIn_0.4s_ease-out]">
      <div className="max-w-lg">
        <h2 className="text-2xl font-bold text-[#f1f5f9] mb-1">Settings</h2>
        <p className="text-sm text-[#94a3b8] mb-6">Manage integrations and preferences</p>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
            Integrations
          </h3>
          <StravaConnect onSynced={onActivitiesChanged} />
        </section>

        <section className="mt-8">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
            Maintenance
          </h3>
          <WaxedChainReminderSettings />
        </section>
      </div>
    </div>
  );
}
