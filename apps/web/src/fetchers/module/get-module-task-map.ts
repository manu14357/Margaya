import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getModuleTaskMap(projectId: string) {
  const response = await client.module.project[":projectId"]["task-map"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getModuleTaskMap;
