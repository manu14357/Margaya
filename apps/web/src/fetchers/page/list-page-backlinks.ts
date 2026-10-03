import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Visible pages that link to this one. */
async function listPageBacklinks(pageId: string) {
  const response = await client.page[":id"].backlinks.$get({
    param: { id: pageId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listPageBacklinks;
