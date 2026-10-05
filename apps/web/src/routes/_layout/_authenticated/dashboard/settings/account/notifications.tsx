import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotificationPreferencesSettings } from "@/components/account/notification-preferences-settings";
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
      <NotificationPreferencesSettings />
    </SettingsPage>
  );
}
