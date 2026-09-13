import { and, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { quickLinkTable } from "../../database/schema";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { QUICK_LINKS_LIMIT } from "../schema";
import {
  DUPLICATE_QUICK_LINK,
  ownQuickLinks,
  publishQuickLinkChanged,
  quickLinkTitle,
  requireQuickLinkUrl,
  toQuickLink,
  withDuplicateMapped,
} from "./shared";

/** Saves a link for the caller; the server never fetches it. */
async function createQuickLink({
  userId,
  workspaceId,
  url,
  title,
}: {
  userId: string;
  workspaceId: string;
  url: string;
  title?: string | null;
}) {
  const normalizedUrl = requireQuickLinkUrl(url);
  const normalizedTitle = quickLinkTitle(title);

  const row = await withDuplicateMapped(() =>
    db.transaction(async (tx) => {
      await lockUserWorkspaceList(
        tx,
        LOCK_NAMESPACE.quickLink,
        userId,
        workspaceId,
      );

      const [duplicate] = await tx
        .select({ id: quickLinkTable.id })
        .from(quickLinkTable)
        .where(
          and(
            ownQuickLinks(userId, workspaceId),
            eq(quickLinkTable.url, normalizedUrl),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new HTTPException(409, { message: DUPLICATE_QUICK_LINK });
      }

      const [stats] = await tx
        .select({ total: count() })
        .from(quickLinkTable)
        .where(ownQuickLinks(userId, workspaceId));
      // 422, not 409: clients tell the cap from a duplicate by status.
      if ((stats?.total ?? 0) >= QUICK_LINKS_LIMIT) {
        throw new HTTPException(422, {
          message: `You can have up to ${QUICK_LINKS_LIMIT} quick links in this workspace`,
        });
      }

      const [inserted] = await tx
        .insert(quickLinkTable)
        .values({
          userId,
          workspaceId,
          url: normalizedUrl,
          title: normalizedTitle,
        })
        .returning();
      if (!inserted) {
        throw new HTTPException(500, { message: "Failed to add quick link" });
      }
      return inserted;
    }),
  );

  await publishQuickLinkChanged(userId, workspaceId, row.id, "created");
  return toQuickLink(row);
}

export default createQuickLink;
