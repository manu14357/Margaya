import { HTTPException } from "hono/http-exception";
import { assertProjectFeatureEnabled } from "../../project/features";
import { assertVisible, type IntakeVisibility } from "../access";
import {
  classifySearch,
  resolvePriorityFilter,
  resolveSourceFilter,
  resolveStatusFilter,
  resolveSubmitterFilter,
} from "../list-filters";
import {
  countIntakeItems,
  listIntakeItemPage,
  loadIntakeItemByTask,
} from "../queries";
import type { IntakeTab } from "../status";
import { requireIntakeItem } from "./shared";

export const DEFAULT_INTAKE_PAGE_SIZE = 50;
export const NOT_FROM_INTAKE = "This task didn't come from intake";

export async function listIntakeItems({
  projectId,
  userId,
  visibility,
  query,
}: {
  projectId: string;
  userId: string;
  visibility: IntakeVisibility;
  query: {
    tab?: IntakeTab;
    status?: string;
    priority?: string;
    source?: string;
    submittedBy?: string;
    search?: string;
    sortBy?: "createdAt" | "updatedAt" | "number";
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
  };
}) {
  const tab = query.tab ?? "open";
  return listIntakeItemPage({
    projectId,
    statuses: resolveStatusFilter(tab, query.status),
    priorities: resolvePriorityFilter(query.priority),
    sources: resolveSourceFilter(query.source),
    submitter: resolveSubmitterFilter(
      query.submittedBy,
      userId,
      visibility === "own",
    ),
    search: classifySearch(query.search),
    sortBy: query.sortBy ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    page: query.page ?? 1,
    limit: query.limit ?? DEFAULT_INTAKE_PAGE_SIZE,
  });
}

export async function getIntakeSummary(projectId: string) {
  const counts = await countIntakeItems({
    projectId,
    priorities: [],
    submitter: { kind: "any" },
    search: { kind: "none" },
  });
  return { pending: counts.pending, snoozed: counts.snoozed };
}

export async function getIntakeItem({
  itemId,
  userId,
  visibility,
}: {
  itemId: string;
  userId: string;
  visibility: IntakeVisibility;
}) {
  const item = await requireIntakeItem(itemId);
  assertVisible(visibility, item, userId);
  return item;
}

/**
 * The request a task came from. The route's middleware checks the feature
 * for the task's current project; an accepted task moved elsewhere is also
 * checked against the queue it was submitted to.
 */
export async function getIntakeItemByTask({
  taskId,
  userId,
  visibility,
}: {
  taskId: string;
  userId: string;
  visibility: IntakeVisibility;
}) {
  const item = await loadIntakeItemByTask(taskId);
  if (!item) throw new HTTPException(404, { message: NOT_FROM_INTAKE });
  if (item.projectId !== item.task.projectId) {
    await assertProjectFeatureEnabled(item.projectId, "intake");
  }
  if (visibility === "own" && item.submittedBy?.id !== userId) {
    throw new HTTPException(404, { message: NOT_FROM_INTAKE });
  }
  return item;
}
