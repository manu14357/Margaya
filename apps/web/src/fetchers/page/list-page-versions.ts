import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Saved versions, newest first (at most 20). */
async function listPageVersions(pageId: string) {
  const response = await client.page[":id"].versions.$get({
    param: { id: pageId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listPageVersions;
