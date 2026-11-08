import { useNavigate } from "@tanstack/react-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import FavoriteButton from "@/components/favorite/favorite-button";
import PageTitle from "@/components/page-title";
import { QueryRowsSkeleton } from "@/components/task-layouts/query-states";
import TaskListSurface from "@/components/task-layouts/task-list-surface";
import { ErrorDisplay } from "@/components/ui/error-display";
import { useRecordVisit } from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetFavorites from "@/hooks/queries/favorite/use-get-favorites";
import { useGetView } from "@/hooks/queries/view/use-get-view";
import { useGetViews } from "@/hooks/queries/view/use-get-views";
import { useTaskQueryState } from "@/hooks/use-task-query-state";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { findFavorite } from "@/lib/favorites";
import { HttpError } from "@/lib/http-error";
import {
  type BuiltInViewKey,
  getBuiltInView,
  isBuiltInViewKey,
} from "@/lib/task-query/built-in-views";
import type {
  TaskLayout,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import { viewPath } from "@/lib/view/entity-link";
import SaveViewActions from "./save-view-actions";
import SavedViewBody from "./saved-view-body";
import ViewFormDialog from "./view-form-dialog";
import { ViewNotFound } from "./view-page-states";
import ViewRowActions from "./view-row-actions";
import WorkspaceViewTabs from "./workspace-view-tabs";
import WorkspaceViewsMenu from "./workspace-views-menu";

export const WORKSPACE_LAYOUTS: readonly TaskLayout[] = [
  "list",
  "board",
  "spreadsheet",
  "gantt",
];

const WORKSPACE_SCOPE: TaskQueryScope = { kind: "workspace" };

type FrameProps = {
  workspaceId: string;
  activeKey: string;
  title: string;
  headerActions?: ReactNode;
  /** The state a new view starts from (the page's current filters). */
  currentState?: TaskQueryState;
  children: ReactNode;
};

/** "All tasks": the tab strip of built-in and favorite views, then a list. */
function WorkspaceViewsFrame({
  workspaceId,
  activeKey,
  title,
  headerActions,
  currentState,
  children,
}: FrameProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canCreateViews, isCheckingPermissions } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canCreate = !isCheckingPermissions && canCreateViews();
  const { data: views = [] } = useGetViews({ workspaceId, projectId: null });
  const { data: favorites } = useGetFavorites({ workspaceId });
  const favoriteTabs = useMemo(
    () =>
      views
        .filter((view) => Boolean(findFavorite(favorites, "view", view.id)))
        .map((view) => ({ id: view.id, name: view.name })),
    [views, favorites],
  );

  return (
    <>
      <PageTitle title={title} />
      <WorkspaceLayout
        title={t("views:allTasks.title")}
        headerActions={headerActions}
      >
        <div className="flex h-full min-h-0 flex-col">
          <WorkspaceViewTabs
            workspaceId={workspaceId}
            activeKey={activeKey}
            extraTabs={favoriteTabs}
            trailing={
              <WorkspaceViewsMenu
                workspaceId={workspaceId}
                views={views}
                activeId={activeKey}
                onNewView={canCreate ? () => setIsCreateOpen(true) : undefined}
              />
            }
          />
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </WorkspaceLayout>
      {canCreate && (
        <ViewFormDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          workspaceId={workspaceId}
          projectId={null}
          currentState={currentState}
          onSaved={(view) =>
            navigate({
              to: viewPath(view.workspaceId, view.id, view.projectId),
            })
          }
        />
      )}
    </>
  );
}

function useCloseTask() {
  const navigate = useNavigate();
  return useCallback(() => {
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        taskId: undefined,
      }),
      replace: true,
    });
  }, [navigate]);
}

function BuiltInViewPage({
  workspaceId,
  viewKey,
  taskId,
}: {
  workspaceId: string;
  viewKey: BuiltInViewKey;
  taskId?: string;
}) {
  const { t } = useTranslation();
  const closeTask = useCloseTask();
  const view = useMemo(() => getBuiltInView(viewKey), [viewKey]);
  const handle = useTaskQueryState({
    storageScope: `view:builtin:${viewKey}`,
    scope: "workspace",
    workspaceId,
    baseline: view.state,
    allowedLayouts: WORKSPACE_LAYOUTS,
  });

  return (
    <WorkspaceViewsFrame
      workspaceId={workspaceId}
      activeKey={viewKey}
      title={t(view.nameKey)}
      currentState={handle.state}
    >
      <TaskListSurface
        workspaceId={workspaceId}
        scope={WORKSPACE_SCOPE}
        handle={handle}
        baseConditions={view.baseConditions}
        layouts={WORKSPACE_LAYOUTS}
        storageKey={`view:builtin:${viewKey}`}
        hiddenSubjects={viewKey === "subscribed" ? ["subscriber"] : undefined}
        actions={
          <SaveViewActions
            workspaceId={workspaceId}
            projectId={null}
            handle={handle}
            baseConditions={view.baseConditions}
          />
        }
        taskId={taskId}
        onCloseTask={closeTask}
      />
    </WorkspaceViewsFrame>
  );
}

function SavedWorkspaceViewPage({
  workspaceId,
  viewId,
  taskId,
}: {
  workspaceId: string;
  viewId: string;
  taskId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const viewQuery = useGetView(workspaceId, viewId);
  const view = viewQuery.data;
  const isNotFound =
    viewQuery.error instanceof HttpError && viewQuery.error.status === 404;

  useRecordVisit({
    workspaceId,
    entityType: "view",
    entityId: view && !view.projectId ? viewId : undefined,
  });

  // A project's view lives on its project page.
  useEffect(() => {
    if (view?.projectId) {
      navigate({
        to: viewPath(workspaceId, view.id, view.projectId),
        replace: true,
      });
    }
  }, [view, workspaceId, navigate]);

  const goToAll = () =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/views/$viewId",
      params: { workspaceId, viewId: "all" },
    });

  return (
    <WorkspaceViewsFrame
      workspaceId={workspaceId}
      activeKey={viewId}
      title={view?.name ?? t("views:allTasks.title")}
      headerActions={
        view ? (
          <div className="flex items-center gap-1">
            <FavoriteButton
              workspaceId={workspaceId}
              entityType="view"
              entityId={view.id}
              placeholder={{ name: view.name, projectId: null }}
            />
            <ViewRowActions
              view={view}
              onDeleted={goToAll}
              onDuplicated={(copy) =>
                navigate({ to: viewPath(workspaceId, copy.id, copy.projectId) })
              }
            />
          </div>
        ) : null
      }
    >
      {view && !view.projectId ? (
        <SavedViewBody key={view.id} view={view} taskId={taskId} />
      ) : isNotFound ? (
        <ViewNotFound workspaceId={workspaceId} />
      ) : viewQuery.isError ? (
        <div className="p-4">
          <ErrorDisplay
            error={viewQuery.error}
            onRetry={() => void viewQuery.refetch()}
          />
        </div>
      ) : (
        <QueryRowsSkeleton />
      )}
    </WorkspaceViewsFrame>
  );
}

type WorkspaceViewsPageProps = {
  workspaceId: string;
  viewId: string;
  taskId?: string;
};

/** "All tasks": the built-in and saved workspace views (B4 §1.5). */
export default function WorkspaceViewsPage({
  workspaceId,
  viewId,
  taskId,
}: WorkspaceViewsPageProps) {
  if (isBuiltInViewKey(viewId)) {
    return (
      <BuiltInViewPage
        key={viewId}
        workspaceId={workspaceId}
        viewKey={viewId}
        taskId={taskId}
      />
    );
  }
  return (
    <SavedWorkspaceViewPage
      key={viewId}
      workspaceId={workspaceId}
      viewId={viewId}
      taskId={taskId}
    />
  );
}
