import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SetTaskRecurrenceBody = InferRequestType<
  (typeof client)["task-recurrence"][":taskId"]["$put"]
>["json"];

/** Makes a task repeat, or replaces its repeat rule. */
async function setTaskRecurrence(taskId: string, body: SetTaskRecurrenceBody) {
  const response = await client["task-recurrence"][":taskId"].$put({
    param: { taskId },
    json: body,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setTaskRecurrence;
