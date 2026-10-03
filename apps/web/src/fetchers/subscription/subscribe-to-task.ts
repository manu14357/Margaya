import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function subscribeToTask(taskId: string) {
  const response = await client.subscription.task[":taskId"].$put({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default subscribeToTask;
