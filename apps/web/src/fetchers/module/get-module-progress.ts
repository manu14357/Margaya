import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getModuleProgress(moduleId: string) {
  const response = await client.module[":id"].progress.$get({
    param: { id: moduleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getModuleProgress;
