import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getPageVersion(pageId: string, versionId: string) {
  const response = await client.page[":id"].versions[":versionId"].$get({
    param: { id: pageId, versionId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getPageVersion;
