import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function reorderFavorites({
  workspaceId,
  favoriteIds,
}: {
  workspaceId: string;
  favoriteIds: string[];
}) {
  const response = await client.favorite.reorder.$put({
    query: { workspaceId },
    json: { favoriteIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default reorderFavorites;
