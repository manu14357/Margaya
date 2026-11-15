import { client } from "@margaya/libs";
import { responseError } from "./response-error";

/** One page of a board's history, newest first. */
export async function listWhiteboardActivity(
  whiteboardId: string,
  cursor?: string | null,
) {
  const response = await client.whiteboard[":id"].activity.$get({
    param: { id: whiteboardId },
    query: cursor ? { cursor } : {},
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
