import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type AssetAccessTarget = {
  workspaceId: string;
  isPublic: boolean | null;
  surface: string;
  /** Set for files uploaded into a page. */
  pageAccess?: string | null;
  pageOwnerId?: string | null;
  /** A public comment of the asset's task references it (B12 §3.13). */
  inPublicComment?: boolean | null;
};

/**
 * The public project representation: description assets, and assets of
 * public comments (hiding, deleting or unpublishing ends public access).
 */
export function isPublicAsset(asset: AssetAccessTarget): boolean {
  if (asset.isPublic !== true) return false;
  return (
    asset.surface === "description" ||
    (asset.surface === "comment" && asset.inPublicComment === true)
  );
}

export async function authorizeAssetAccess(
  c: Context,
  asset: AssetAccessTarget,
): Promise<void> {
  if (isPublicAsset(asset)) {
    return;
  }

  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
  await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);

  // A private page's files are its owner's only, like the page itself.
  if (asset.pageAccess === "private" && asset.pageOwnerId !== userId) {
    throw new HTTPException(403, { message: "No access to this asset" });
  }
}
