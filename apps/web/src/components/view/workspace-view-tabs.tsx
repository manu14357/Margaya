import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { builtInViews } from "@/lib/task-query/built-in-views";

type WorkspaceViewTabsProps = {
  workspaceId: string;
  activeKey: string;
  /** Favorite saved views, after the built-ins. */
  extraTabs?: ReadonlyArray<{ id: string; name: string }>;
  /** The "Views ▾" menu at the end. */
  trailing?: ReactNode;
};

/** The tab strip under "All tasks": built-ins, favorites, all views. */
export default function WorkspaceViewTabs({
  workspaceId,
  activeKey,
  extraTabs = [],
  trailing,
}: WorkspaceViewTabsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = (viewId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/views/$viewId",
      params: { workspaceId, viewId },
    });

  return (
    <nav
      aria-label={t("views:nav.title")}
      className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-border/80 border-b bg-card px-2"
    >
      <Tabs value={activeKey}>
        <TabsList variant="underline" className="h-9 gap-1 py-0">
          {builtInViews().map((view) => (
            <TabsTab
              key={view.key}
              value={view.key}
              onClick={() => open(view.key)}
              className="h-7 grow-0 px-2 text-xs sm:h-7 sm:text-sm"
            >
              {t(view.nameKey)}
            </TabsTab>
          ))}
          {extraTabs.map((view) => (
            <TabsTab
              key={view.id}
              value={view.id}
              onClick={() => open(view.id)}
              className="h-7 max-w-48 grow-0 px-2 text-xs sm:h-7 sm:text-sm"
            >
              <span className="truncate">{view.name}</span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {trailing}
    </nav>
  );
}
