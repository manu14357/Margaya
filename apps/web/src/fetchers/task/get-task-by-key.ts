import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Resolves a readable key (WEB-12, any case) inside a workspace. */
async function getTaskByKey(workspaceId: string, key: string) {
  const response = await client.task["by-key"][":workspaceId"][":key"].$get({
    param: { workspaceId, key },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskByKey;
