import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

export type PageAssetUploadRequest = {
  filename: string;
  contentType: string;
  size: number;
};

/** A presigned upload URL for an image or file in a page. */
async function createPageAssetUpload(
  pageId: string,
  json: PageAssetUploadRequest,
) {
  const response = await client.page[":id"]["asset-upload"].$put({
    param: { id: pageId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createPageAssetUpload;
