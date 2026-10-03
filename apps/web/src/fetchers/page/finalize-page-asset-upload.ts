import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function finalizePageAssetUpload(
  pageId: string,
  json: { key: string; filename: string; contentType: string; size: number },
) {
  const response = await client.page[":id"]["asset-upload"].finalize.$post({
    param: { id: pageId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default finalizePageAssetUpload;
