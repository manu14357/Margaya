import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Replaces the content with markdown (for API-style callers; the editor syncs live). */
async function replacePageContent(pageId: string, markdown: string) {
  const response = await client.page[":id"].content.$put({
    param: { id: pageId },
    json: { markdown },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default replacePageContent;
