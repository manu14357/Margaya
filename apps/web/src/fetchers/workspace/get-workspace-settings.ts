import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getWorkspaceSettings(workspaceId: string) {
  const response = await client.workspace[":workspaceId"].settings.$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceSettings;
