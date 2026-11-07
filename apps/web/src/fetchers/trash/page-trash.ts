import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import { TRASH_PAGE_SIZE } from "./task-trash";

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

/** One page of a project's deleted pages, most recently deleted first. */
export async function listPageTrash({
  projectId,
  search,
  page = 1,
}: {
  projectId: string;
  search?: string;
  page?: number;
}) {
  return read(
    await client.trash.project[":projectId"].pages.$get({
      param: { projectId },
      query: {
        search: search?.trim() || undefined,
        page: String(page),
        limit: String(TRASH_PAGE_SIZE),
      },
    }),
  );
}

/** Brings a deleted page back into the project's archive. */
export async function restoreDeletedPage(pageId: string) {
  return read(
    await client.trash.page[":pageId"].restore.$post({ param: { pageId } }),
  );
}

/** Deletes a page in the trash permanently. */
export async function purgePage(pageId: string) {
  return read(
    await client.trash.page[":pageId"].$delete({ param: { pageId } }),
  );
}
