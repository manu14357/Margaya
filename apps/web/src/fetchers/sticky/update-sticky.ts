import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type StickyChanges = InferRequestType<
  (typeof client)["sticky"][":id"]["$patch"]
>["json"];

async function updateSticky({
  workspaceId,
  stickyId,
  changes,
}: {
  workspaceId: string;
  stickyId: string;
  changes: StickyChanges;
}) {
  const response = await client.sticky[":id"].$patch({
    param: { id: stickyId },
    query: { workspaceId },
    json: changes,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateSticky;
