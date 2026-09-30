import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteModule(moduleId: string) {
  const response = await client.module[":id"].$delete({
    param: { id: moduleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteModule;
