import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import type Task from "@/types/task";
import TriageSuggestions from "./triage-suggestions";

/** A task counts as new for this long after it was created. */
const NEW_TASK_MS = 48 * 60 * 60 * 1000;

/** Whether the task detail offers triage: a new or an unlabelled task. */
export function wantsTriage(
  task: Pick<Task, "createdAt">,
  labelCount: number,
  now = Date.now(),
): boolean {
  if (labelCount === 0) return true;
  const created = Date.parse(task.createdAt);
  return Number.isFinite(created) && now - created < NEW_TASK_MS;
}

/** Triage Copilot in the task detail, only where it helps. */
export default function TaskTriageEntry({
  task,
  workspaceId,
  onEditDuplicate,
  className,
}: {
  task: Task;
  workspaceId: string;
  onEditDuplicate?: () => void;
  className?: string;
}) {
  const { data: labels, isLoading } = useGetLabelsByTask(task.id);
  if (isLoading || task.archivedAt) return null;
  if (!wantsTriage(task, (labels ?? []).length)) return null;
  return (
    <TriageSuggestions
      task={task}
      workspaceId={workspaceId}
      onEditDuplicate={onEditDuplicate}
      className={className}
    />
  );
}
