import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type ApplyWorkspaceStarterRequest = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["starter"]["$post"]
>["json"] & { workspaceId: string };

/** Creates every project of a starter in an empty workspace, in one step. */
async function applyWorkspaceStarter({
  workspaceId,
  ...json
}: ApplyWorkspaceStarterRequest) {
  const response = await client.workspace[":workspaceId"].starter.$post({
    param: { workspaceId },
    json,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default applyWorkspaceStarter;
