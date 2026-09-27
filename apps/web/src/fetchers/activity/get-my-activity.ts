import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type MyActivityPage = InferResponseType<
  (typeof client)["activity"]["mine"]["$get"],
  200
>;
export type MyActivityItem = MyActivityPage["items"][number];

/** A page of the current user's own activity in a workspace, newest first. */
async function getMyActivity({
  workspaceId,
  cursor,
  limit = 10,
}: {
  workspaceId: string;
  cursor?: string;
  limit?: number;
}): Promise<MyActivityPage> {
  const response = await client.activity.mine.$get({
    query: {
      workspaceId,
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getMyActivity;
