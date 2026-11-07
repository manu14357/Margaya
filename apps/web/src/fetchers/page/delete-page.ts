import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Moves an archived page to the trash; its sub-pages move to the top level. */
async function deletePage(pageId: string) {
  const response = await client.page[":id"].$delete({
    param: { id: pageId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deletePage;
