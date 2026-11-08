import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type AssetAccessTarget = {
  workspaceId: string;
  /** Files of a restricted project are its members' only. */
  projectId?: string | null;
  isPublic: boolean | null;
  surface: string;
  /** Set for files uploaded into a page. */
  pageAccess?: string | null;
  pageOwnerId?: string | null;
  /** Its task, page or project is in the trash. */
  inTrash?: boolean | null;
  /** In the trash, and nothing live links the file (utils/asset-trash.ts). */
  gone?: boolean | null;
  /** A public comment of the asset's task references it (B12 §3.13). */
  inPublicComment?: boolean | null;
  /** In the trash, and live public text shows the file (utils/asset-trash.ts). */
  publicHolder?: boolean | null;
};

/**
 * The public project representation: description assets, and assets of
 * public comments (hiding, deleting or unpublishing ends public access).
 * Anything in the trash is off the public board, unless live public text (a
 * task on a public board, a published page) still shows its file; private
 * text keeps it for the workspace only.
 */
export function isPublicAsset(asset: AssetAccessTarget): boolean {
  if (asset.isPublic !== true || asset.gone) return false;
  if (asset.inTrash && asset.publicHolder !== true) return false;
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

  const { userId, apiKeyId, keyPermissions, keyProjectIds } =
    await resolveAssetBearerOrCookie(c);

  // This route runs before the API's own authentication, so the key isn't on
  // the request and nothing further down applies its limits.
  const outsideKey =
    keyProjectIds?.length && !keyProjectIds.includes(asset.projectId ?? "");
  const area = asset.surface === "page" ? "page" : "task";
  if (
    outsideKey ||
    (keyPermissions && !keyPermissions[area]?.includes("read"))
  ) {
    throw new HTTPException(403, { message: "No access to this asset" });
  }

  await validateWorkspaceAccess(
    userId,
    asset.workspaceId,
    apiKeyId,
    asset.projectId,
  );

  // A private page's files are its owner's only, like the page itself.
  if (asset.pageAccess === "private" && asset.pageOwnerId !== userId) {
    throw new HTTPException(403, { message: "No access to this asset" });
  }

  // What is in the trash reads as gone (C7) until it is restored.
  if (asset.gone) {
    throw new HTTPException(403, { message: "No access to this asset" });
  }
}
