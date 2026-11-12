import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { ContextPanelSlot } from "@/components/context-panel/panel-slot";
import {
  SettingsInlineNav,
  SettingsPanelNav,
  settingsAreaFromPath,
  useSettingsAreaLabels,
} from "@/components/settings/settings-nav";

/** The top bar's place: "Settings · {area}". */
function SettingsPlace() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const areaLabel = useSettingsAreaLabels()[settingsAreaFromPath(pathname)];

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
 * scrolling canvas the pages render into. Every settings page renders in it,
 * including Members, which keeps its workspace URL.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <Layout.TopBar place={<SettingsPlace />} />
      <ContextPanelSlot fallback={<SettingsInlineNav />}>
        <SettingsPanelNav />
      </ContextPanelSlot>
      {/* relative: screen-reader-only tables (position: absolute) stay in
          this scroller instead of stretching the document, which otherwise
          lets scrollIntoView scroll the whole window. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-slot="settings-canvas"
      >
        {children}
      </div>
    </Layout>
  );
}
