import type { UploadedEditorAsset } from "@/components/editor/use-editor-asset-upload";
import createPageAssetUpload from "@/fetchers/page/create-page-asset-upload";
import finalizePageAssetUpload from "@/fetchers/page/finalize-page-asset-upload";
import { getImageAltText, isSupportedImageFile } from "@/lib/upload-task-image";

/** Uploads an image or file into a page: presign, PUT, finalize. */
export async function uploadPageAsset(
  pageId: string,
  file: File,
): Promise<UploadedEditorAsset> {
  if (file.size <= 0) {
    throw new Error("Only non-empty file uploads are supported.");
  }
  const filename = file.name || "file";
  const contentType = file.type || "application/octet-stream";
  const upload = await createPageAssetUpload(pageId, {
    filename,
    contentType,
    size: file.size,
  });
  // Presigned storage URL, not an API route: the client would add JSON headers.
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error("Failed to upload file to storage.");
  }
  const asset = await finalizePageAssetUpload(pageId, {
    key: upload.key,
    filename,
    contentType,
    size: file.size,
  });
  return {
    url: asset.url,
    alt: getImageAltText(filename),
    filename,
    kind: isSupportedImageFile(file) ? "image" : "attachment",
    mimeType: contentType,
    size: file.size,
  };
}
