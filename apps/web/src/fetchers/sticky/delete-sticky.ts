import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteSticky({
  workspaceId,
  stickyId,
}: {
  workspaceId: string;
  stickyId: string;
}) {
  const response = await client.sticky[":id"].$delete({
    param: { id: stickyId },
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteSticky;
