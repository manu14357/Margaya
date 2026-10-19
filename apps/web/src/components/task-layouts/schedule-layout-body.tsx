import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import ProjectCalendar from "@/components/calendar/project-calendar";
import ProjectGantt from "@/components/gantt/project-gantt";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useClassicBoardFilter } from "@/hooks/use-classic-board-filter";
import type { FilterCondition, TaskQueryState } from "@/lib/task-query/model";

type ScheduleLayoutBodyProps = {
  layout: "calendar" | "gantt";
  workspaceId: string;
  projectId: string;
  state: Pick<TaskQueryState, "filters" | "archived" | "display">;
  baseConditions?: readonly FilterCondition[];
};

/**
 * Calendar or Gantt inside a task list page (a project's saved view): the
 * project's loaded tasks, narrowed by the page's filters the same way the
 * project's own Calendar and Gantt pages narrow them.
 */
export default function ScheduleLayoutBody({
  layout,
  workspaceId,
  projectId,
  state,
  baseConditions,
}: ScheduleLayoutBodyProps) {
  const navigate = useNavigate();
  const { data: loadedProject, isLoading, isError } = useGetTasks(projectId);
  const { filteredProject } = useClassicBoardFilter({
    workspaceId,
    projectId,
    state,
    project: loadedProject,
    baseConditions,
  });
  const openTask = useCallback(
    (taskId: string) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          taskId,
        }),
        replace: true,
      }),
    [navigate],
  );

  if (layout === "calendar") {
    return (
      <ProjectCalendar
        workspaceId={workspaceId}
        projectId={projectId}
        loadedProject={loadedProject}
        project={filteredProject}
        isLoading={isLoading}
        isError={isError}
        onOpenTask={openTask}
        renderToolbar={(calendarToolbar) => (
          <div className="flex shrink-0 items-center justify-end border-border/80 border-b px-2 py-1.5 md:px-3">
            {calendarToolbar}
          </div>
        )}
      />
    );
  }
  return (
    <ProjectGantt
      workspaceId={workspaceId}
      projectId={projectId}
      loadedProject={loadedProject}
      project={filteredProject}
      isLoading={isLoading}
      onOpenTask={openTask}
    />
  );
}
