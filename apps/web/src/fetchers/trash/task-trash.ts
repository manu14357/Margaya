import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

export const TRASH_PAGE_SIZE = 50;

async function read<T>(response: {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<T>;
}) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

/** One page of a project's trash, most recently deleted first. */
export async function listTaskTrash({
  projectId,
  search,
  page = 1,
}: {
  projectId: string;
  search?: string;
  page?: number;
}) {
  return read(
    await client.trash.project[":projectId"].tasks.$get({
      param: { projectId },
      query: {
        search: search?.trim() || undefined,
        page: String(page),
        limit: String(TRASH_PAGE_SIZE),
      },
    }),
  );
}

/** Brings a trashed task back with the sub-tasks deleted with it. */
export async function restoreTask(taskId: string) {
  return read(
    await client.trash.task[":taskId"].restore.$post({ param: { taskId } }),
  );
}

/** Deletes a trashed task (and its batch) permanently. */
export async function purgeTask(taskId: string) {
  return read(
    await client.trash.task[":taskId"].$delete({ param: { taskId } }),
  );
}

/** Deletes every task in a project's trash permanently. */
export async function emptyTaskTrash(projectId: string) {
  return read(
    await client.trash.project[":projectId"].empty.$post({
      param: { projectId },
    }),
  );
}
