import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateWorkspaceSettings({
  workspaceId,
  timezone,
}: {
  workspaceId: string;
  timezone: string;
}) {
  const response = await client.workspace[":workspaceId"].settings.$patch({
    param: { workspaceId },
    json: { timezone },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateWorkspaceSettings;
