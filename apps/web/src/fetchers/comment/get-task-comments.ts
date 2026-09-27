import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type TaskComment = InferResponseType<
  (typeof client)["comment"][":taskId"]["$get"],
  200
>[number];

/**
 * A task's comments with each author's name, avatar and whether they are a
 * workspace member or a guest: public board authors are usually outsiders.
 */
async function getTaskComments(taskId: string, signal?: AbortSignal) {
  const response = await client.comment[":taskId"].$get(
    { param: { taskId } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default getTaskComments;
