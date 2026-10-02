import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type QuickLinkChanges = InferRequestType<
  (typeof client)["quick-link"][":id"]["$patch"]
>["json"];

async function updateQuickLink({
  workspaceId,
  quickLinkId,
  changes,
}: {
  workspaceId: string;
  quickLinkId: string;
  changes: QuickLinkChanges;
}) {
  const response = await client["quick-link"][":id"].$patch({
    param: { id: quickLinkId },
    query: { workspaceId },
    json: changes,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateQuickLink;
