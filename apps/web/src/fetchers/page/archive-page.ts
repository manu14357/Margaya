import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Archives the page and every sub-page. */
async function archivePage(pageId: string) {
  const response = await client.page[":id"].archive.$post({
    param: { id: pageId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default archivePage;
