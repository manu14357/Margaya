import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateProjectFeaturesRequest = InferRequestType<
  (typeof client)["project"][":id"]["features"]["$patch"]
>["json"];

async function updateProjectFeatures(
  id: string,
  features: UpdateProjectFeaturesRequest,
) {
  const response = await client.project[":id"].features.$patch({
    param: { id },
    json: features,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateProjectFeatures;
