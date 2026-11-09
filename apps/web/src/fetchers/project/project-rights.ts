import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const mine = client.project.access.mine;

export type ProjectRights = InferResponseType<
  (typeof mine)["$get"],
  200
>["projects"][number];

/**
 * My project roles in a workspace where they cap my rights (a guest's
 * projects, my restricted ones), each with what it grants. One request
 * covers every project of the workspace.
 */
export async function getMyProjectRights(
  workspaceId: string,
): Promise<ProjectRights[]> {
  const response = await mine.$get({ query: { workspaceId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return ((await response.json()) as { projects: ProjectRights[] }).projects;
}
