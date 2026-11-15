import { client } from "@margaya/libs";
import { responseError } from "@/fetchers/whiteboard/response-error";
import { TRASH_PAGE_SIZE } from "./task-trash";

/** One page of a project's deleted whiteboards, most recently deleted first. */
export async function listWhiteboardTrash({
  projectId,
  search,
  page = 1,
}: {
  projectId: string;
  search?: string;
  page?: number;
}) {
  const response = await client.trash.project[":projectId"].whiteboards.$get({
    param: { projectId },
    query: {
      search: search?.trim() || undefined,
      page: String(page),
      limit: String(TRASH_PAGE_SIZE),
    },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Brings a deleted board back to the project's archived boards. */
export async function restoreDeletedWhiteboard(whiteboardId: string) {
  const response = await client.trash.whiteboard[":whiteboardId"].restore.$post(
    {
      param: { whiteboardId },
    },
  );
  if (!response.ok) throw await responseError(response);
  return response.json();
}

/** Deletes a board in the trash permanently. */
export async function purgeWhiteboard(whiteboardId: string) {
  const response = await client.trash.whiteboard[":whiteboardId"].$delete({
    param: { whiteboardId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
