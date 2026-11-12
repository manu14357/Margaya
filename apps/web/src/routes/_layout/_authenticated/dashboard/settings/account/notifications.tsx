import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotificationPreferencesSettings } from "@/components/account/notification-preferences-settings";
import { NotificationSoundSettings } from "@/components/account/notification-sound-settings";
import { QuietHoursSettings } from "@/components/account/quiet-hours-settings";
import { SettingsPage } from "@/components/settings-layout";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/notifications",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();

  return (
    <SettingsPage
      title={t("settings:notificationsPage.title")}
      documentTitle={t("settings:notificationsPage.pageTitle")}
      description={t("settings:notificationsPage.subtitle")}
    >
      {/* What, then where, then when and how it sounds; per-workspace rules last. */}
      <NotificationPreferencesSettings
        sounds={
          <>
            <QuietHoursSettings />
            <NotificationSoundSettings />
          </>
        }
      />
    </SettingsPage>
  );
}
