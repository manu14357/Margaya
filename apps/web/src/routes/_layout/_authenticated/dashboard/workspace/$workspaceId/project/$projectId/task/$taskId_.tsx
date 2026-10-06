import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import TaskLayout from "@/components/common/task-layout";
import PageTitle from "@/components/page-title";
import TaskActionsMenu from "@/components/task/task-actions-menu";
import TaskDeleteButton from "@/components/task/task-delete-button";
import TaskDetailsContent from "@/components/task/task-details-content";
import {
  TaskDetailsSkeleton,
  TaskPropertiesSidebarSkeleton,
} from "@/components/task/task-page-skeleton";
import TaskPropertiesSidebar from "@/components/task/task-properties-sidebar";
import TaskSurfaceShortcuts from "@/components/task/task-shortcuts/task-surface-shortcuts";
import TaskStepper from "@/components/task/task-stepper";
import TaskSubscribeButton from "@/components/task/task-subscribe-button";
import { useMinWidth } from "@/components/task/use-min-width";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetActivitiesByTaskId from "@/hooks/queries/activity/use-get-activities-by-task-id";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId_",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId, taskId } = Route.useParams();
  const {
    data: task,
    isLoading: isTaskLoading,
    isError: isTaskError,
  } = useGetTask(taskId);
  const { data: project, isLoading: isProjectLoading } = useGetProject({
    id: projectId,
    workspaceId,
  });
  const { isLoading: isActivitiesLoading } = useGetActivitiesByTaskId(taskId);
  useRecordVisit({
    workspaceId,
    entityType: "task",
    entityId: taskId,
    archived: visitArchiveState(task, project),
  });
  const [isShikiReady, setIsShikiReady] = useState(false);
  useEffect(() => {
    let mounted = true;

    void import("@/lib/shiki-highlighter")
      .then(({ getSharedShikiHighlighter }) => getSharedShikiHighlighter())
      .then(() => {
        if (!mounted) return;
        setIsShikiReady(true);
      })
      .catch((err) => {
        console.error("Failed to initialize Shiki highlighter:", err);
        if (!mounted) return;
        // Render the task view without syntax highlighting rather than
        // leaving the page stuck in a permanent loading state.
        setIsShikiReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // The side panel from 1024px; below it the grid follows the description.
  const isWide = useMinWidth(1024);

  const isLoading =
    isTaskLoading || isProjectLoading || isActivitiesLoading || !isShikiReady;

  const handleDeleted = () => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
      replace: true,
    });
  };

  const goToTask = (nextTaskId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId, taskId: nextTaskId },
    });

  // The page ↔ sheet switch: the board with this task open beside it.
  const openOnBoard = () =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId },
      search: { taskId },
    });

  const properties = (
    <TaskPropertiesSidebar
      taskId={taskId}
      projectId={projectId}
      workspaceId={workspaceId}
      className={
        isWide ? undefined : "rounded-lg border border-border bg-sidebar/40"
      }
    />
  );

  return (
    <TaskLayout
      taskId={taskId}
      projectId={projectId}
      workspaceId={workspaceId}
      headerActions={
        !isLoading && task ? (
          <div className="flex items-center gap-0.5">
            <TaskStepper
              projectId={projectId}
              taskId={taskId}
              onNavigate={goToTask}
              fetch
              showPosition={false}
              className="mr-1 hidden md:flex"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hidden text-foreground md:inline-flex"
                    aria-label={t("tasks:detail.openOnBoard")}
                    onClick={openOnBoard}
                  >
                    <PanelRight className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("tasks:detail.openOnBoard")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TaskSubscribeButton taskId={taskId} size="icon" />
            <TaskActionsMenu
              taskId={taskId}
              projectId={projectId}
              workspaceId={workspaceId}
            />
            <span data-task-delete="" className="contents">
              <TaskDeleteButton taskId={taskId} onDeleted={handleDeleted} />
            </span>
          </div>
        ) : null
      }
    >
      <PageTitle
        title={
          isLoading
            ? t("tasks:common.loadingTask")
            : isTaskError || !task
              ? t("tasks:common.taskNotFound")
              : `${project?.slug}-${task?.number} · ${task?.title}`
        }
        hideAppName
      />
      {isLoading ? (
        <div className="flex min-h-full">
          <TaskDetailsSkeleton className="min-w-0 flex-1" />
          {isWide && (
            <TaskPropertiesSidebarSkeleton className="w-72 shrink-0 border-border/80 border-l bg-card xl:w-80" />
          )}
        </div>
      ) : isTaskError || !task ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-12 text-center">
          <h1 className="text-2xl font-bold">
            {t("tasks:common.taskNotFound")}
          </h1>
          <p className="text-muted-foreground max-w-md">
            {t("tasks:common.taskNotFoundDescription", {
              defaultValue:
                "The task you are looking for does not exist or has been deleted.",
            })}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                params: { workspaceId, projectId },
              })
            }
          >
            {t("navigation:sidebar.backToBoard", {
              defaultValue: "Back to board",
            })}
          </Button>
        </div>
      ) : (
        // Keyed: stepping to another task remounts the body, as the sheet does.
        <div className="flex min-h-full" key={taskId} data-task-surface="">
          <TaskSurfaceShortcuts
            taskId={taskId}
            projectId={projectId}
            workspaceId={workspaceId}
          />
          <div className="min-w-0 flex-1">
            <TaskDetailsContent
              taskId={taskId}
              projectId={projectId}
              workspaceId={workspaceId}
              className="mx-auto w-full max-w-3xl px-4 pt-5 pb-16 sm:px-6 xl:pt-8 xl:pb-20"
              properties={isWide ? undefined : properties}
            />
          </div>
          {isWide && (
            <aside className="w-72 shrink-0 border-border/80 border-l bg-card xl:w-80">
              {/* Stays in view while the task body scrolls. */}
              <div className="sticky top-0 max-h-[calc(100dvh-3rem)] overflow-y-auto">
                {properties}
              </div>
            </aside>
          )}
        </div>
      )}
    </TaskLayout>
  );
}
