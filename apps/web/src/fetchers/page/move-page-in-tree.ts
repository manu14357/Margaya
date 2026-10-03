import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Moves a page within its project's tree: under `parentId`, after `afterId`. */
async function movePageInTree(
  pageId: string,
  json: { parentId: string | null; afterId: string | null },
) {
  const response = await client.page[":id"].position.$put({
    param: { id: pageId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default movePageInTree;
