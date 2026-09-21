import {
  compareTasksByEstimate,
  type EstimatePointLookup,
} from "@/lib/estimate/sort";
import type Task from "@/types/task";

export type SortField =
  | "position"
  | "createdAt"
  | "priority"
  | "estimate"
  | "dueDate"
  | "title"
  | "number";

export type SortDirection = "asc" | "desc";

export type SortConfig = {
  field: SortField;
  direction: SortDirection;
};

const priorityOrder: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function getPriorityValue(priority: string | null): number {
  if (!priority) return 0;
  return priorityOrder[priority] ?? 0;
}

/** What some sort fields need beyond the tasks themselves. */
export type SortContext = {
  /** The active estimate system's points; without it, estimate sort is off. */
  estimatePointsById?: EstimatePointLookup;
};

export function sortTasks(
  tasks: Task[],
  config: SortConfig,
  context: SortContext = {},
): Task[] {
  if (config.field === "position") {
    return tasks;
  }

  if (config.field === "estimate") {
    const pointsById = context.estimatePointsById;
    // Unestimated tasks stay last in both directions, so the direction is
    // applied inside the comparison instead of by negating it.
    return pointsById
      ? [...tasks].sort((a, b) =>
          compareTasksByEstimate(a, b, pointsById, config.direction),
        )
      : tasks;
  }

  const sorted = [...tasks].sort((a, b) => {
    let comparison = 0;

    switch (config.field) {
      case "priority": {
        comparison =
          getPriorityValue(a.priority) - getPriorityValue(b.priority);
        break;
      }
      case "dueDate": {
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        if (!a.dueDate && !b.dueDate) comparison = 0;
        else if (!a.dueDate) comparison = 1;
        else if (!b.dueDate) comparison = -1;
        else comparison = aDate - bDate;
        break;
      }
      case "createdAt": {
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      }
      case "title": {
        comparison = a.title.localeCompare(b.title);
        break;
      }
      case "number": {
        comparison = (a.number ?? 0) - (b.number ?? 0);
        break;
      }
    }

    return config.direction === "asc" ? comparison : -comparison;
  });

  return sorted;
}
