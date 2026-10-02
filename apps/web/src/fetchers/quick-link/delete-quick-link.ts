import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteQuickLink({
  workspaceId,
  quickLinkId,
}: {
  workspaceId: string;
  quickLinkId: string;
}) {
  const response = await client["quick-link"][":id"].$delete({
    param: { id: quickLinkId },
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteQuickLink;
