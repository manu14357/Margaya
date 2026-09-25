import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type EntityParam = InferRequestType<
  (typeof client)["favorite"]["entity"][":entityType"][":entityId"]["$delete"]
>["param"];

async function deleteFavoriteByEntity({
  workspaceId,
  entityType,
  entityId,
}: EntityParam & { workspaceId: string }) {
  const response = await client.favorite.entity[":entityType"][
    ":entityId"
  ].$delete({
    param: { entityType, entityId },
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteFavoriteByEntity;
