import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import TaskCrumbSelect from "@/components/common/header/task-crumb-select";
import Layout from "@/components/common/layout";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";

type TaskLayoutProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  /** The top bar's primary-action slot. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** The properties column: beside the body from 1024px, above it below. */
  rightSidebar?: ReactNode;
};

/** A task opened as a page: project · task key switcher, then the task. */
export default function TaskLayout({
  taskId,
  projectId,
  workspaceId,
  headerActions,
  children,
  rightSidebar,
}: TaskLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: task } = useGetTask(taskId);

  useProjectWebSocket(projectId);

  const taskLabel =
    project?.slug && task?.number != null
      ? `${project.slug}-${task.number}`
      : t("tasks:common.selectTask");

  const handleTaskSwitch = (nextTaskId: string) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId, taskId: nextTaskId },
    });
  };

  return (
    <Layout>
      <Layout.TopBar
        place={
          <>
            <ProjectTile
              icon={project?.icon}
              seed={project?.id}
              className="size-6"
            />
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                  params: { workspaceId, projectId },
                })
              }
              className="hidden max-w-40 truncate rounded-md px-1.5 py-1 text-left font-medium text-[13px] text-foreground outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:block"
            >
              {project?.name || t("navigation:sidebar.projects")}
            </button>
            <span
              aria-hidden
              className="hidden text-muted-foreground/60 sm:inline"
            >
              ·
            </span>
            <TaskCrumbSelect
              projectId={projectId}
              taskId={taskId}
              taskLabel={taskLabel}
              onSelectTask={handleTaskSwitch}
            />
          </>
        }
        actions={headerActions}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-border/80 border-b lg:hidden">
            {rightSidebar}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </div>
        <div className="hidden border-border/80 border-l bg-card lg:flex lg:h-full lg:overflow-y-auto">
          {rightSidebar}
        </div>
      </div>
    </Layout>
  );
}
