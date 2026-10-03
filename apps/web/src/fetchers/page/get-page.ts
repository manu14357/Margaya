import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getPage(pageId: string) {
  const response = await client.page[":id"].$get({ param: { id: pageId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getPage;
