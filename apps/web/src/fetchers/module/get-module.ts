import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getModule(moduleId: string) {
  const response = await client.module[":id"].$get({
    param: { id: moduleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getModule;
