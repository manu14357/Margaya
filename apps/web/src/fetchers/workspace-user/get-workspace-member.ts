import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type WorkspaceMemberProfile = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["members"][":userId"]["$get"],
  200
>;

/** One member's profile header; 404 when they are not in the workspace. */
async function getWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberProfile> {
  const response = await client.workspace[":workspaceId"].members[
    ":userId"
  ].$get({ param: { workspaceId, userId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWorkspaceMember;
