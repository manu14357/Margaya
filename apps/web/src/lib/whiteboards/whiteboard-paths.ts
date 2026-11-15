import { getApiUrl } from "@/fetchers/get-api-url";

export function whiteboardsListPath(
  workspaceId: string,
  projectId: string,
): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/whiteboards`;
}

export function whiteboardPath(
  workspaceId: string,
  projectId: string,
  whiteboardId: string,
): string {
  return `${whiteboardsListPath(workspaceId, projectId)}/${whiteboardId}`;
}

/** The read-only public link of a published board (a web route). */
export function publicWhiteboardPath(token: string): string {
  return `/public-whiteboard/${encodeURIComponent(token)}`;
}

/**
 * The board's preview image. The version busts the browser cache after each
 * save; the API caches it privately for a minute.
 */
export function whiteboardPreviewUrl(
  whiteboardId: string,
  contentVersion: number,
): string {
  return `${getApiUrl(`/whiteboard/${encodeURIComponent(whiteboardId)}/preview.svg`)}?v=${contentVersion}`;
}

/** An image on a board, read with the viewer's session. */
export function whiteboardAssetUrl(
  whiteboardId: string,
  assetId: string,
): string {
  return getApiUrl(
    `/whiteboard/${encodeURIComponent(whiteboardId)}/assets/${encodeURIComponent(assetId)}`,
  );
}

/** An image on a published board, read without signing in. */
export function publicWhiteboardAssetUrl(
  token: string,
  assetId: string,
): string {
  return getApiUrl(
    `/public-whiteboard/${encodeURIComponent(token)}/assets/${encodeURIComponent(assetId)}`,
  );
}
