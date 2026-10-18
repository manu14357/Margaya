import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateWorkspaceSettings({
  workspaceId,
  ...json
}: {
  workspaceId: string;
  timezone?: string;
  allowPublicPages?: boolean;
  allowA2a?: boolean;
}) {
  const response = await client.workspace[":workspaceId"].settings.$patch({
    param: { workspaceId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateWorkspaceSettings;
