import type { IntakeItem } from "@/types/intake";

/** A pending request of project p1, with overrides. */
export function intakeItem(
  overrides: Partial<Omit<IntakeItem, "task">> & {
    task?: Partial<IntakeItem["task"]>;
  } = {},
): IntakeItem {
  const { task, ...rest } = overrides;
  return {
    id: "item-1",
    projectId: "p1",
    taskId: "task-1",
    status: "pending",
    snoozedUntil: null,
    source: "in_app",
    resolutionNote: null,
    submittedBy: { id: "user-ana", name: "Ana", image: null },
    triagedBy: null,
    triagedAt: null,
    duplicateOf: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...rest,
    task: {
      id: "task-1",
      projectId: "p1",
      number: 42,
      key: "web-42",
      title: "Export fails on Safari",
      priority: "high",
      status: "triage",
      columnId: "col-triage",
      columnName: "Triage",
      group: "triage",
      assigneeId: null,
      dueDate: null,
      updatedAt: "2026-09-20T10:00:00.000Z",
      ...task,
    },
  };
}
