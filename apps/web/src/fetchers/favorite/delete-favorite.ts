import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteFavorite({
  id,
  workspaceId,
}: {
  id: string;
  workspaceId: string;
}) {
  const response = await client.favorite[":id"].$delete({
    param: { id },
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteFavorite;
