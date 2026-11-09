import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const people = client.project[":id"].people;

export type ProjectAudience = InferResponseType<(typeof people)["$get"], 200>;

/** Who can see a project (ids, names, avatars): whom its pickers offer. */
export async function getProjectAudience(
  projectId: string,
): Promise<ProjectAudience> {
  const response = await people.$get({ param: { id: projectId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as ProjectAudience;
}
