import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function reorderStickies({
  workspaceId,
  stickyIds,
}: {
  workspaceId: string;
  stickyIds: string[];
}) {
  const response = await client.sticky.reorder.$put({
    query: { workspaceId },
    json: { stickyIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default reorderStickies;
