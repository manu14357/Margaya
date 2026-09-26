import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$put"]
>["json"] &
  InferRequestType<(typeof client)["project"][":id"]["$put"]>["param"];

async function updateProject({
  id,
  name,
  icon,
  slug,
  description,
  isPublic,
  leadUserId,
  defaultAssigneeUserId,
}: UpdateProjectRequest) {
  const response = await client.project[":id"].$put({
    param: { id },
    // Lead and default assignee are optional: omitted keeps them.
    json: {
      name,
      icon,
      slug,
      description,
      isPublic,
      ...(leadUserId !== undefined ? { leadUserId } : {}),
      ...(defaultAssigneeUserId !== undefined ? { defaultAssigneeUserId } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default updateProject;
