import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function unsubscribeFromTask(taskId: string) {
  const response = await client.subscription.task[":taskId"].$delete({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default unsubscribeFromTask;
