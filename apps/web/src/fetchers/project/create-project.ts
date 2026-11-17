import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateProjectRequest = InferRequestType<
  (typeof client)["project"]["$post"]
>["json"];

export type CreatedProject = InferResponseType<
  (typeof client)["project"]["$post"],
  200
>;

async function createProject({
  name,
  slug,
  workspaceId,
  icon,
  fromProjectId,
  copy,
  visibility,
  template,
  features,
}: CreateProjectRequest): Promise<CreatedProject> {
  const response = await client.project.$post({
    // `copy` only means something with a source project, and a source
    // project and a template exclude each other.
    json: fromProjectId
      ? {
          name,
          slug,
          icon,
          workspaceId,
          fromProjectId,
          copy,
          visibility,
          features,
        }
      : { name, slug, icon, workspaceId, visibility, template, features },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return (await response.json()) as CreatedProject;
}

export default createProject;
