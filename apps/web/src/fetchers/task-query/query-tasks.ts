import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskQueryRequest } from "@/types/task-query";

/** POST /api/task-query: filter, group, order and page tasks. */
async function queryTasks(request: TaskQueryRequest, signal?: AbortSignal) {
  const response = await client["task-query"].$post(
    { json: request },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default queryTasks;
