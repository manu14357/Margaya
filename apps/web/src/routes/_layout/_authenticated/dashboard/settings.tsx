import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { SettingsFrame } from "@/components/settings/settings-frame";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings",
)({
  component: SettingsLayout,
  notFoundComponent: SettingsNotFound,
});

// A settings path the loaded route tree doesn't know: usually a tab opened
// before an update added the page. A reload fetches the current routes.
// It renders in the layout's outlet, inside the settings frame.
function SettingsNotFound() {
  const { t } = useTranslation();
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t("navigation:page.settingsNotFoundTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("navigation:page.settingsNotFoundDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button size="sm" onClick={() => window.location.reload()}>
          {t("navigation:page.settingsNotFoundReload")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/dashboard/settings/account/information" />}
        >
          {t("navigation:page.settingsNotFoundBack")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <>
      <PageTitle title={t("navigation:page.settingsTitle")} />
      <SettingsFrame>
        <Outlet />
      </SettingsFrame>
    </>
  );
}
