import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { PublicTaskListQuery } from "@/types/public-board";

/** One page of the board's tasks per column, or the next page of one column. */
async function listPublicBoardTasks(
  token: string,
  query: PublicTaskListQuery,
  signal?: AbortSignal,
) {
  const response = await client["public-board"][":token"].tasks.$get(
    { param: { token }, query },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default listPublicBoardTasks;
