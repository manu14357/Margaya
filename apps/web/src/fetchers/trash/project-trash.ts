import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import { TRASH_PAGE_SIZE } from "./task-trash";

/** One page of the workspace's trashed projects, newest first. */
export async function listProjectTrash({
  workspaceId,
  search,
  page = 1,
}: {
  workspaceId: string;
  search?: string;
  page?: number;
}) {
  const response = await client.trash.projects.$get({
    query: {
      workspaceId,
      search: search?.trim() || undefined,
      page: String(page),
      limit: String(TRASH_PAGE_SIZE),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** Brings a trashed project back with the tasks deleted with it. */
export async function restoreProject(projectId: string) {
  const response = await client.trash.projects[":projectId"].restore.$post({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** Deletes a trashed project permanently. */
export async function purgeProject(projectId: string) {
  const response = await client.trash.projects[":projectId"].$delete({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
