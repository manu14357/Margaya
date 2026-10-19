import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import TaskListSurface from "@/components/task-layouts/task-list-surface";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import type { TaskLayout, TaskQueryScope } from "@/lib/task-query/model";
import {
  type MyWorkListTab,
  type MyWorkTab,
  myWorkBaseConditions,
  myWorkDefaultState,
  presetFilters,
} from "@/lib/task-query/my-work";
import MyWorkSummary from "./my-work-summary";
import { MyWorkTabs } from "./my-work-tabs";

const LAYOUTS: readonly TaskLayout[] = ["list", "board", "spreadsheet"];
const SCOPE: TaskQueryScope = { kind: "workspace" };

const EMPTY_KEYS: Record<MyWorkListTab, string> = {
  assigned: "myWork:empty.assigned",
  created: "myWork:empty.created",
  subscribed: "myWork:empty.subscribed",
};

type MyWorkPageProps = {
  workspaceId: string;
  tab: MyWorkTab;
  preset?: string;
  taskId?: string;
};

function MyWorkList({
  workspaceId,
  tab,
  preset,
  taskId,
}: {
  workspaceId: string;
  tab: MyWorkListTab;
  preset?: string;
  taskId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const baseline = useMemo(() => myWorkDefaultState(), []);
  const baseConditions = useMemo(() => myWorkBaseConditions(tab), [tab]);
  const handle = useTaskQueryState({
    storageScope: `my-work:${tab}`,
    scope: "workspace",
    workspaceId,
    baseline,
    allowedLayouts: LAYOUTS,
  });

  // A summary tile opens its tab with its filters, once.
  const { setFilters } = handle;
  useEffect(() => {
    if (!preset) return;
    setFilters(presetFilters(preset));
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        filter: undefined,
      }),
      replace: true,
    });
  }, [preset, setFilters, navigate]);

  const closeTask = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);

  return (
    <TaskListSurface
      workspaceId={workspaceId}
      scope={SCOPE}
      handle={handle}
      baseConditions={baseConditions}
      layouts={LAYOUTS}
      storageKey={`my-work:${tab}`}
      hiddenSubjects={tab === "subscribed" ? ["subscriber"] : undefined}
      emptyTitle={t(EMPTY_KEYS[tab])}
      emptyDescription=""
      taskId={taskId}
      onCloseTask={closeTask}
    />
  );
}

/**
 * "Your work": the view tabs (Summary, then what is assigned to, created or
 * watched by you), each list grouped by state.
 */
export default function MyWorkPage({
  workspaceId,
  tab,
  preset,
  taskId,
}: MyWorkPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const openTab = (next: MyWorkTab, nextPreset?: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/my-work",
      params: { workspaceId },
      search: {
        tab: next === "summary" ? undefined : next,
        ...(nextPreset ? { filter: nextPreset } : {}),
      },
    });

  return (
    <>
      <PageTitle title={t("myWork:title")} />
      <Layout>
        <Layout.TopBar title={t("myWork:title")} />
        <MyWorkTabs
          workspaceId={workspaceId}
          value={tab}
          onSelectTab={(next) => openTab(next)}
        />
        {tab === "summary" ? (
          <Layout.ContentArea width="wide">
            <MyWorkSummary
              workspaceId={workspaceId}
              onOpen={(next, nextPreset) => openTab(next, nextPreset)}
            />
          </Layout.ContentArea>
        ) : (
          <div className="min-h-0 flex-1">
            <MyWorkList
              key={tab}
              workspaceId={workspaceId}
              tab={tab}
              preset={preset}
              taskId={taskId}
            />
          </div>
        )}
      </Layout>
    </>
  );
}
