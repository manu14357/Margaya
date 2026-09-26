import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Archives a task in its column; archiving an archived task is a no-op. */
async function archiveTask(taskId: string) {
  const response = await client.task.archive[":id"].$post({
    param: { id: taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default archiveTask;
