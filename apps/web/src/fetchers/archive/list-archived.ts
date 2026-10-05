import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { ArchivedEntityType } from "@/types/archive";

export const ARCHIVE_PAGE_SIZE = 50;

/** One page of archived cycles, modules or projects, newest first. */
async function listArchived({
  workspaceId,
  projectId,
  type,
  search,
  page = 1,
}: {
  workspaceId: string;
  projectId?: string;
  type: ArchivedEntityType;
  search?: string;
  page?: number;
}) {
  const response = await client.archive[":type"].$get({
    param: { type },
    query: {
      workspaceId,
      projectId: projectId || undefined,
      search: search?.trim() || undefined,
      page: String(page),
      limit: String(ARCHIVE_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listArchived;
