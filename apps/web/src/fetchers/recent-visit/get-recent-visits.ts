import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type RecentVisitEntityType = NonNullable<
  InferRequestType<
    (typeof client)["recent-visit"]["$get"]
  >["query"]["entityType"]
>;

async function getRecentVisits({
  workspaceId,
  entityType,
  limit,
}: {
  workspaceId: string;
  entityType?: RecentVisitEntityType;
  limit?: number;
}) {
  const response = await client["recent-visit"].$get({
    query: {
      workspaceId,
      ...(entityType ? { entityType } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getRecentVisits;
