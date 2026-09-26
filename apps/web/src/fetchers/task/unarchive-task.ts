import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Restores an archived task to its column and position. */
async function unarchiveTask(taskId: string) {
  const response = await client.task.unarchive[":id"].$post({
    param: { id: taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default unarchiveTask;
