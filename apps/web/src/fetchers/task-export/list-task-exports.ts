import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskExportScope } from "@/types/task-export";

export const TASK_EXPORT_PAGE_SIZE = 20;

/** One page of a workspace's exports, newest first. */
async function listTaskExports({
  workspaceId,
  scope,
  cursor,
}: {
  workspaceId: string;
  scope: TaskExportScope;
  cursor?: string | null;
}) {
  const response = await client["task-export"].$get({
    query: {
      workspaceId,
      scope,
      cursor: cursor || undefined,
      limit: String(TASK_EXPORT_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listTaskExports;
