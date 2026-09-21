import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export type TaskCandidate = {
  task: Task;
  key: string;
  column: { slug: string; icon: string | null; group?: string | null };
};

/**
 * Tasks an "Add existing tasks" picker offers: the visible tasks that pass
 * `isCandidate`, planned ones first, then by board column and task number.
 */
export function taskCandidates(
  project: ProjectWithTasks | null | undefined,
  isCandidate: (task: Task) => boolean,
): TaskCandidate[] {
  if (!project) return [];
  const key = (task: Task) => `${project.slug}-${task.number ?? ""}`;
  const byNumber = (a: Task, b: Task) => (a.number ?? 0) - (b.number ?? 0);

  const planned = [...(project.plannedTasks ?? [])]
    .filter(isCandidate)
    .sort(byNumber)
    .map((task) => ({
      task,
      key: key(task),
      column: { slug: "planned", icon: null, group: "backlog" },
    }));

  const inColumns = project.columns.flatMap((column) =>
    column.tasks
      .filter(isCandidate)
      .sort(byNumber)
      .map((task) => ({
        task,
        key: key(task),
        column: { slug: column.slug, icon: column.icon, group: column.group },
      })),
  );

  return [...planned, ...inColumns];
}

/** Matches the key (e.g. "WEB-12") or the title, case-insensitively. */
export function searchCandidates(
  candidates: readonly TaskCandidate[],
  query: string,
): TaskCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...candidates];
  return candidates.filter(
    (candidate) =>
      candidate.key.toLowerCase().includes(needle) ||
      candidate.task.title.toLowerCase().includes(needle),
  );
}
