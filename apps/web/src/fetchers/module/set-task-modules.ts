import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function setTaskModules(
  taskId: string,
  json: { addModuleIds?: string[]; removeModuleIds?: string[] },
) {
  const response = await client.module.task[":taskId"].$put({
    param: { taskId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setTaskModules;
