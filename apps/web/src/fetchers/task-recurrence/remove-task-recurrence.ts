import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Stops a task repeating; instances created already stay. */
async function removeTaskRecurrence(taskId: string) {
  const response = await client["task-recurrence"][":taskId"].$delete({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default removeTaskRecurrence;
