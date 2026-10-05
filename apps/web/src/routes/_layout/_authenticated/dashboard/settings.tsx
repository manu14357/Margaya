import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { ContextPanelSlot } from "@/components/context-panel/panel-slot";
import PageTitle from "@/components/page-title";
import {
  SettingsInlineNav,
  SettingsPanelNav,
  settingsAreaFromPath,
} from "@/components/settings/settings-nav";
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

/** The top bar's place: "Settings · {area}". */
function SettingsPlace() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const area = settingsAreaFromPath(pathname);
  const areaLabel = {
    account: t("settings:account"),
    workspace: t("navigation:page.settingsWorkspaceTab"),
    project: t("navigation:projectSettings.projectLabel"),
    instance: t("navigation:page.settingsInstanceTab"),
  }[area];

  return (
    <>
      <h1 className="truncate px-1 font-semibold text-[15px] text-foreground">
        {t("navigation:page.settingsTitle")}
      </h1>
      <span aria-hidden className="hidden text-muted-foreground/60 sm:inline">
        ·
      </span>
      <span className="hidden truncate text-[15px] text-muted-foreground sm:inline">
        {areaLabel}
      </span>
    </>
  );
}

/**
 * The settings frame: the top bar, the section navigation (in the context
 * panel, or as a strip under the top bar while the panel is closed) and the
 * scrolling canvas the pages render into.
 */
function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <Layout.TopBar place={<SettingsPlace />} />
      <ContextPanelSlot fallback={<SettingsInlineNav />}>
        <SettingsPanelNav />
      </ContextPanelSlot>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-slot="settings-canvas"
      >
        {children}
      </div>
    </Layout>
  );
}

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
