import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

export async function archiveModule(moduleId: string) {
  const response = await client.module[":id"].archive.$post({
    param: { id: moduleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export async function unarchiveModule(moduleId: string) {
  const response = await client.module[":id"].unarchive.$post({
    param: { id: moduleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}
