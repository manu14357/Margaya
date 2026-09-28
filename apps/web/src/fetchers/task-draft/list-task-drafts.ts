import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskDraftFilters } from "@/types/task-draft";

export const TASK_DRAFT_PAGE_SIZE = 50;

/** One page of the caller's drafts in a workspace, newest edit first. */
async function listTaskDrafts(
  workspaceId: string,
  filters: TaskDraftFilters,
  page = 1,
) {
  const response = await client["task-draft"].$get({
    query: {
      workspaceId,
      projectId: filters.projectId || undefined,
      search: filters.q?.trim() || undefined,
      page: String(page),
      limit: String(TASK_DRAFT_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listTaskDrafts;
