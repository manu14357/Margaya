import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type TaskLink = InferResponseType<
  (typeof client)["task-link"][":taskId"]["$get"],
  200
>[number];

async function getTaskLinks(taskId: string) {
  const response = await client["task-link"][":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskLinks;
