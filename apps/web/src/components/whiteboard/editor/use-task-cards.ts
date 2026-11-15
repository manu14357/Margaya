import type { TaskCardData } from "@margaya/whiteboard";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { columnTones } from "@/components/kanban-board/column/column-tone";
import getTask from "@/fetchers/task/get-task";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { columnGroupOf } from "@/lib/column-groups";
import type Task from "@/types/task";
import { resolveCssColor } from "./theme-colors";

// Live task data for the board's task cards. The project's task list is one
// batched (and usually already cached) query, shared with the board view and
// refreshed by the project socket, so cards follow task changes for free.
// Cards of tasks outside that list (another project) fall back to one query
// per task, capped so a pasted wall of foreign cards cannot flood the API.

const MAX_SINGLE_LOOKUPS = 40;

export type TaskCardSource = {
  cards: ReadonlyMap<string, TaskCardData>;
  /** Live (not archived) tasks of the project, for the picker. */
  tasks: readonly Task[];
  columns: readonly { id: string; name: string; slug: string }[];
  projectSlug: string;
  isLoading: boolean;
};

type ColumnInfo = { name: string; color: string | null; done: boolean };

function toCard(
  task: Pick<
    Task,
    "title" | "number" | "status" | "assigneeName" | "dueDate" | "priority"
  >,
  slug: string,
  column: ColumnInfo | undefined,
): TaskCardData {
  return {
    key: task.number != null && slug ? `${slug}-${task.number}` : "",
    title: task.title,
    statusName: column?.name ?? task.status,
    statusColor: column?.color ?? null,
    assigneeName: task.assigneeName ?? null,
    dueDate: task.dueDate ?? null,
    priority:
      task.priority && task.priority !== "no-priority" ? task.priority : null,
    done: column?.done ?? false,
  };
}

function combineData<T>(results: { data?: T }[]): (T | undefined)[] {
  return results.map((result) => result.data);
}

export function useTaskCards(
  projectId: string,
  taskIds: readonly string[],
  options: { enabled: boolean; theme: "light" | "dark" },
): TaskCardSource {
  const enabled = options.enabled && Boolean(projectId);
  const board = useGetTasks(enabled ? projectId : "");
  const columnRecords = useGetColumns(enabled ? projectId : "");
  const project = board.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the colour tokens resolve differently per theme
  const columnInfo = useMemo(() => {
    const map = new Map<string, ColumnInfo>();
    if (!project) return map;
    const tones = columnTones(
      project.columns,
      new Map(columnRecords.data?.map((record) => [record.slug, record.color])),
    );
    for (const column of project.columns) {
      const group = columnGroupOf(column);
      map.set(column.slug, {
        name: column.name,
        // Theme is a dependency: the tokens resolve differently per theme.
        color: resolveCssColor(tones.get(column.id)?.color),
        done: group === "completed" || group === "cancelled",
      });
    }
    return map;
  }, [project, columnRecords.data, options.theme]);

  const projectTasks = useMemo(() => {
    const map = new Map<string, Task>();
    if (!project) return map;
    for (const column of project.columns)
      for (const task of column.tasks) map.set(task.id, task);
    for (const task of project.plannedTasks) map.set(task.id, task);
    for (const task of project.archivedTasks) map.set(task.id, task);
    return map;
  }, [project]);

  const missing = useMemo(() => {
    if (!enabled || board.isLoading) return [];
    return taskIds
      .filter((id) => !projectTasks.has(id))
      .slice(0, MAX_SINGLE_LOOKUPS);
  }, [enabled, board.isLoading, taskIds, projectTasks]);

  const singleData = useQueries({
    queries: missing.map((taskId) => ({
      queryKey: ["task", taskId],
      queryFn: () => getTask(taskId),
      retry: false,
      staleTime: 60_000,
    })),
    combine: combineData,
  });

  const cards = useMemo(() => {
    const map = new Map<string, TaskCardData>();
    const slug = project?.slug ?? "";
    for (const id of taskIds) {
      const task = projectTasks.get(id);
      if (task) map.set(id, toCard(task, slug, columnInfo.get(task.status)));
    }
    missing.forEach((id, index) => {
      const data = singleData[index] as
        | (Partial<Task> & { title?: string })
        | undefined;
      if (!data || typeof data.title !== "string") return;
      map.set(
        id,
        toCard(
          {
            title: data.title,
            number: data.number ?? null,
            status: data.status ?? "",
            assigneeName: data.assigneeName ?? null,
            dueDate: data.dueDate ?? null,
            priority: data.priority ?? null,
          },
          "",
          undefined,
        ),
      );
    });
    return map;
  }, [taskIds, projectTasks, columnInfo, missing, project?.slug, singleData]);

  const tasks = useMemo(() => {
    if (!project) return [];
    return [
      ...project.columns.flatMap((column) => column.tasks),
      ...project.plannedTasks,
    ];
  }, [project]);

  const columns = useMemo(
    () =>
      (project?.columns ?? []).map((column) => ({
        id: column.id,
        name: column.name,
        slug: column.slug,
      })),
    [project?.columns],
  );

  return {
    cards,
    tasks,
    columns,
    projectSlug: project?.slug ?? "",
    isLoading: board.isLoading,
  };
}
