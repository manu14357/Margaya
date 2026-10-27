import { useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import type { ViewTab } from "@/components/common/view-tabs";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import TaskListSurface from "@/components/task-layouts/task-list-surface";
import { useWorkspaceMember } from "@/hooks/queries/workspace-users/use-workspace-member";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { HttpError } from "@/lib/http-error";
import { memberAssignedConditions } from "@/lib/task-query/member-work";
import type { TaskLayout, TaskQueryScope } from "@/lib/task-query/model";
import { myWorkDefaultState, presetFilters } from "@/lib/task-query/my-work";
import MemberProfileHeader from "./member-profile-header";
import MemberProfileOverview from "./member-profile-overview";

export type MemberProfileTab = "overview" | "assigned";

const LAYOUTS: readonly TaskLayout[] = ["list", "board", "spreadsheet"];
const SCOPE: TaskQueryScope = { kind: "workspace" };

type MemberProfilePageProps = {
  workspaceId: string;
  userId: string;
  tab: MemberProfileTab;
  preset?: string;
  taskId?: string;
};

function AssignedList({
  workspaceId,
  userId,
  preset,
  taskId,
  emptyTitle,
}: {
  workspaceId: string;
  userId: string;
  preset?: string;
  taskId?: string;
  emptyTitle: string;
}) {
  const navigate = useNavigate();
  const baseline = useMemo(() => myWorkDefaultState(), []);
  const baseConditions = useMemo(
    () => memberAssignedConditions(userId),
    [userId],
  );
  const handle = useTaskQueryState({
    storageScope: "member-profile:assigned",
    scope: "workspace",
    workspaceId,
    baseline,
    allowedLayouts: LAYOUTS,
  });

  // A tile or row of the overview opens this list with its filters, once.
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
      storageKey="member-profile:assigned"
      emptyTitle={emptyTitle}
      emptyDescription=""
      taskId={taskId}
      onCloseTask={closeTask}
      quickAdd={false}
    />
  );
}

/**
 * A workspace member's profile: who they are, their numbers, workload and
 * recent activity, and the tasks assigned to them. Everything comes from
 * the same reads the viewer's own lists use, so nothing they cannot see
 * shows here.
 */
export default function MemberProfilePage({
  workspaceId,
  userId,
  tab,
  preset,
  taskId,
}: MemberProfilePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const member = useWorkspaceMember(workspaceId, userId);
  const notMember =
    member.error instanceof HttpError && member.error.status === 404;
  const title = member.data?.name ?? t("team:profile.title");

  const openTab = (next: MemberProfileTab, nextPreset?: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/profile/$userId",
      params: { workspaceId, userId },
      search: {
        tab: next === "overview" ? undefined : next,
        ...(nextPreset ? { filter: nextPreset } : {}),
      },
    });

  const tabs: ViewTab[] = [
    {
      value: "overview",
      label: t("team:profile.tabs.overview"),
      icon: LayoutDashboard,
      onSelect: () => openTab("overview"),
    },
    {
      value: "assigned",
      label: t("team:profile.tabs.assigned"),
      icon: UserRoundCheck,
      onSelect: () => openTab("assigned"),
    },
  ];

  if (notMember || (member.isError && !member.data)) {
    return (
      <>
        <PageTitle title={t("team:profile.title")} />
        <Layout>
          <Layout.TopBar title={t("team:profile.title")} />
          <Layout.ContentArea width="wide">
            <p className="py-16 text-center text-muted-foreground text-sm">
              {notMember
                ? t("team:profile.notMember")
                : t("team:profile.loadError")}
            </p>
          </Layout.ContentArea>
        </Layout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={title} />
      <Layout>
        <Layout.TopBar title={title} />
        <Layout.ViewTabs
          label={t("team:profile.viewsLabel")}
          tabs={tabs}
          value={tab}
        />
        {tab === "overview" ? (
          <Layout.ContentArea width="wide">
            <div className="flex flex-col gap-5">
              <MemberProfileHeader
                workspaceId={workspaceId}
                member={member.data}
                isLoading={member.isLoading}
                isSelf={user?.id === userId}
              />
              <MemberProfileOverview
                workspaceId={workspaceId}
                userId={userId}
                onOpenAssigned={(nextPreset) => openTab("assigned", nextPreset)}
              />
            </div>
          </Layout.ContentArea>
        ) : (
          <div className="min-h-0 flex-1">
            <AssignedList
              workspaceId={workspaceId}
              userId={userId}
              preset={preset}
              taskId={taskId}
              emptyTitle={t("team:profile.emptyAssigned")}
            />
          </div>
        )}
      </Layout>
    </>
  );
}
