import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateModuleLinkRequest = InferRequestType<
  (typeof client)["module"][":id"]["links"]["$post"]
>["json"];

export type UpdateModuleLinkRequest = InferRequestType<
  (typeof client)["module"][":id"]["links"][":linkId"]["$put"]
>["json"];

export async function createModuleLink(
  moduleId: string,
  json: CreateModuleLinkRequest,
) {
  const response = await client.module[":id"].links.$post({
    param: { id: moduleId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export async function updateModuleLink(
  moduleId: string,
  linkId: string,
  json: UpdateModuleLinkRequest,
) {
  const response = await client.module[":id"].links[":linkId"].$put({
    param: { id: moduleId, linkId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export async function deleteModuleLink(moduleId: string, linkId: string) {
  const response = await client.module[":id"].links[":linkId"].$delete({
    param: { id: moduleId, linkId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}
