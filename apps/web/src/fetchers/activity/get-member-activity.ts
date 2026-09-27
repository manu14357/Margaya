import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { MyActivityPage } from "./get-my-activity";

/** A page of a workspace member's activity, newest first (their profile). */
async function getMemberActivity({
  workspaceId,
  userId,
  cursor,
  limit = 10,
}: {
  workspaceId: string;
  userId: string;
  cursor?: string;
  limit?: number;
}): Promise<MyActivityPage> {
  const response = await client.activity.member[":userId"].$get({
    param: { userId },
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

export default getMemberActivity;
