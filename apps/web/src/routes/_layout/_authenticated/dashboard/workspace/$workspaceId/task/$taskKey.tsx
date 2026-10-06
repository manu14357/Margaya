import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import { TaskDetailsSkeleton } from "@/components/task/task-page-skeleton";
import { Button } from "@/components/ui/button";
import useGetTaskByKey from "@/hooks/queries/task/use-get-task-by-key";

// A readable task link (…/task/WEB-12): resolves the key in this workspace
// and replaces itself with the task's page. Id links keep their own route.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/task/$taskKey",
)({
  component: TaskKeyRedirect,
});

function TaskKeyRedirect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId, taskKey } = Route.useParams();
  const { data: task, isError } = useGetTaskByKey(workspaceId, taskKey);

  useEffect(() => {
    if (!task) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId: task.projectId, taskId: task.id },
      replace: true,
    });
  }, [task, navigate, workspaceId]);

  if (isError) {
    return (
      <WorkspaceLayout title={taskKey.toUpperCase()}>
        <PageTitle title={t("tasks:common.taskNotFound")} hideAppName />
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-12 text-center">
          <h1 className="font-bold text-2xl">
            {t("tasks:common.taskNotFound")}
          </h1>
          <p className="max-w-md text-muted-foreground">
            {t("tasks:readableLink.notFound", {
              key: taskKey.toUpperCase(),
            })}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId",
                params: { workspaceId },
              })
            }
          >
            {t("tasks:readableLink.goHome")}
          </Button>
        </div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout title={taskKey.toUpperCase()}>
      <PageTitle title={t("tasks:common.loadingTask")} hideAppName />
      <TaskDetailsSkeleton className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6" />
    </WorkspaceLayout>
  );
}
