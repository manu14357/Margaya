import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import type { RecentVisitEntityType } from "@/fetchers/recent-visit/get-recent-visits";
import useGetRecentVisits from "@/hooks/queries/recent-visit/use-get-recent-visits";
import { getEntityLink, getEntityPath } from "@/lib/entity-links";
import RecentRow from "./recent-row";
import WidgetSection, { WidgetEmpty, WidgetError } from "./widget-section";

export type RecentsTab = "all" | "task" | "project" | "page";

const RECENTS_LIMIT = 20;
const COLLAPSED_COUNT = 8;

const TAB_LABEL_KEYS: Record<RecentsTab, string> = {
  all: "home:recents.tabs.all",
  task: "home:recents.tabs.tasks",
  project: "home:recents.tabs.projects",
  page: "home:recents.tabs.pages",
};

const EMPTY_KEYS: Record<RecentsTab, string> = {
  all: "home:recents.empty.all",
  task: "home:recents.empty.tasks",
  project: "home:recents.empty.projects",
  page: "home:recents.empty.pages",
};

/** The tabs to offer: Pages only once the page entity link is registered. */
export function recentsTabs(): RecentsTab[] {
  return getEntityLink("page")
    ? ["all", "task", "project", "page"]
    : ["all", "task", "project"];
}

type RecentsWidgetProps = {
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
};

export default function RecentsWidget({
  workspaceId,
  onOpenTask,
}: RecentsWidgetProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RecentsTab>("all");
  const [expanded, setExpanded] = useState(false);
  const tabs = recentsTabs();
  const entityType: RecentVisitEntityType | undefined =
    tab === "all" ? undefined : tab;
  const { data, isLoading, isError, refetch, dataUpdatedAt } =
    useGetRecentVisits({ workspaceId, entityType, limit: RECENTS_LIMIT });

  // Queries do not refetch on mount by default; recents must be fresh each
  // time Home (or a tab) opens, so a cached tab refetches once.
  const refreshedTabs = useRef(new Set<RecentsTab>());
  useEffect(() => {
    if (refreshedTabs.current.has(tab)) return;
    refreshedTabs.current.add(tab);
    if (dataUpdatedAt > 0) void refetch();
  }, [tab, dataUpdatedAt, refetch]);

  const visits = (data ?? []).filter(
    (visit) =>
      getEntityLink(visit.entity.type) &&
      getEntityPath(visit.entity, workspaceId),
  );
  const shown = expanded ? visits : visits.slice(0, COLLAPSED_COUNT);

  return (
    <WidgetSection
      title={t("home:widgets.recents")}
      actions={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as RecentsTab);
            setExpanded(false);
          }}
          className="gap-0"
        >
          <TabsList>
            {tabs.map((value) => (
              <TabsTab
                key={value}
                value={value}
                className="h-7 px-2 text-xs sm:h-6 sm:text-xs"
              >
                {t(TAB_LABEL_KEYS[value])}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {isLoading ? (
        <ul className="space-y-1" aria-busy="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <li key={index} className="flex h-11 items-center gap-3 px-2">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-4 w-3/5" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <WidgetError
          message={t("home:recents.loadError")}
          retryLabel={t("home:retry")}
          onRetry={() => void refetch()}
        />
      ) : visits.length === 0 ? (
        <WidgetEmpty>{t(EMPTY_KEYS[tab])}</WidgetEmpty>
      ) : (
        <div className="space-y-1">
          <ul className="space-y-0.5">
            {shown.map((visit) => (
              <RecentRow
                key={visit.id}
                visit={visit}
                workspaceId={workspaceId}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
          {visits.length > COLLAPSED_COUNT && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded
                ? t("home:recents.showLess")
                : t("home:recents.showMore")}
            </Button>
          )}
        </div>
      )}
    </WidgetSection>
  );
}
