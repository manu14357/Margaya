import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** A task's repeat rule; `recurrence` is null when it does not repeat. */
async function getTaskRecurrence(taskId: string) {
  const response = await client["task-recurrence"][":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskRecurrence;
