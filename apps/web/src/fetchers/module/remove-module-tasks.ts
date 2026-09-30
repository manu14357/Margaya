import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function removeModuleTasks(moduleId: string, taskIds: string[]) {
  const response = await client.module[":id"].tasks.$delete({
    param: { id: moduleId },
    json: { taskIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default removeModuleTasks;
