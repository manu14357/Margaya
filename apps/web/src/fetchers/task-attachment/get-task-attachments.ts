import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type TaskAttachment = InferResponseType<
  (typeof client)["task-attachment"][":taskId"]["$get"],
  200
>[number];

async function getTaskAttachments(taskId: string) {
  const response = await client["task-attachment"][":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskAttachments;
