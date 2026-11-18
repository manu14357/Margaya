import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const permissions = client.workspace[":workspaceId"].permissions;

export type MyWorkspacePermissions = InferResponseType<
  (typeof permissions)["$get"],
  200
>;

/** My role in the workspace and every permission it grants me, in one call. */
async function getMyWorkspacePermissions(
  workspaceId: string,
): Promise<MyWorkspacePermissions> {
  const response = await permissions.$get({ param: { workspaceId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as MyWorkspacePermissions;
}

export default getMyWorkspacePermissions;
