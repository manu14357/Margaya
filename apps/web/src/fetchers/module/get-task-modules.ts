import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getTaskModules(taskId: string) {
  const response = await client.module.task[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskModules;
