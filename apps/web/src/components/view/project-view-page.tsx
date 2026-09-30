import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import FavoriteButton from "@/components/favorite/favorite-button";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { QueryRowsSkeleton } from "@/components/task-layouts/query-states";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useGetView } from "@/hooks/queries/view/use-get-view";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import SavedViewBody from "./saved-view-body";
import ViewCrumbSelect from "./view-crumb-select";
import { ViewNotFound } from "./view-page-states";
import ViewRowActions from "./view-row-actions";

type ProjectViewPageProps = {
  workspaceId: string;
  projectId: string;
  viewId: string;
  taskId?: string;
};

/** A project's saved view (B4 §1.4): its list, and its actions. */
export default function ProjectViewPage({
  workspaceId,
  projectId,
  viewId,
  taskId,
}: ProjectViewPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const viewQuery = useGetView(workspaceId, viewId);
  const view = viewQuery.data;
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const isNotFound =
    viewQuery.error instanceof HttpError && viewQuery.error.status === 404;

  useRecordVisit({
    workspaceId,
    entityType: "view",
    entityId: view ? viewId : undefined,
    // A project view is unavailable while its project is archived.
    archived: visitArchiveState(project),
  });

  const goToList = () =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/views",
      params: { workspaceId, projectId },
    });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="views"
      extraCrumbs={
        <ViewCrumbSelect
          workspaceId={workspaceId}
          projectId={projectId}
          view={view}
        />
      }
      headerActions={
        view ? (
          <div className="flex items-center gap-1">
            {!isCheckingPermissions && canCreateTasks() && (
              <Button
                variant="outline"
                size="xs"
                className="gap-1"
                onClick={() => setIsTaskModalOpen(true)}
              >
                <Plus className="size-3" />
                {t("views:detail.addTask")}
              </Button>
            )}
            <FavoriteButton
              workspaceId={workspaceId}
              entityType="view"
              entityId={view.id}
              placeholder={{
                name: view.name,
                projectId,
                feature: "views",
              }}
            />
            <ViewRowActions
              view={view}
              onDeleted={goToList}
              onDuplicated={(copy) =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/views/$viewId",
                  params: { workspaceId, projectId, viewId: copy.id },
                })
              }
            />
          </div>
        ) : null
      }
    >
      <PageTitle
        title={`${project?.name ?? ""} · ${view?.name ?? t("views:nav.title")}`}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="views"
      >
        {view ? (
          <SavedViewBody key={view.id} view={view} taskId={taskId} />
        ) : isNotFound ? (
          <ViewNotFound workspaceId={workspaceId} projectId={projectId} />
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
      </ProjectFeatureGate>
      <CreateTaskModal
        open={isTaskModalOpen}
        projectId={projectId}
        onClose={() => setIsTaskModalOpen(false)}
      />
    </ProjectLayout>
  );
}
