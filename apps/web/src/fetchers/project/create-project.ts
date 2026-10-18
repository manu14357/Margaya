import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateProjectRequest = InferRequestType<
  (typeof client)["project"]["$post"]
>["json"];

async function createProject({
  name,
  slug,
  workspaceId,
  icon,
  fromProjectId,
  copy,
  visibility,
}: CreateProjectRequest) {
  const response = await client.project.$post({
    // `copy` only means something with a source project.
    json: fromProjectId
      ? { name, slug, icon, workspaceId, fromProjectId, copy, visibility }
      : { name, slug, icon, workspaceId, visibility },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default createProject;
