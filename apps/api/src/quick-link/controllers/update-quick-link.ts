import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { quickLinkTable } from "../../database/schema";
import {
  DUPLICATE_QUICK_LINK,
  ownQuickLinks,
  publishQuickLinkChanged,
  QUICK_LINK_NOT_FOUND,
  quickLinkTitle,
  requireQuickLinkUrl,
  toQuickLink,
  withDuplicateMapped,
} from "./shared";

/**
 * Changes a quick link's URL and/or title. Saving the same values writes
 * nothing and publishes nothing.
 */
async function updateQuickLink({
  userId,
  workspaceId,
  id,
  url,
  title,
}: {
  userId: string;
  workspaceId: string;
  id: string;
  url?: string;
  title?: string | null;
}) {
  if (url === undefined && title === undefined) {
    throw new HTTPException(400, {
      message: "Provide a url or title to update",
    });
  }
  const nextUrl = url === undefined ? undefined : requireQuickLinkUrl(url);
  const nextTitle = title === undefined ? undefined : quickLinkTitle(title);

  const own = and(
    ownQuickLinks(userId, workspaceId),
    eq(quickLinkTable.id, id),
  );
  const [current] = await db.select().from(quickLinkTable).where(own).limit(1);
  // Another user's link is indistinguishable from a missing one.
  if (!current) {
    throw new HTTPException(404, { message: QUICK_LINK_NOT_FOUND });
  }

  const values = {
    url: nextUrl ?? current.url,
    title: nextTitle === undefined ? current.title : nextTitle,
  };
  if (values.url === current.url && values.title === current.title) {
    return toQuickLink(current);
  }

  if (values.url !== current.url) {
    const [duplicate] = await db
      .select({ id: quickLinkTable.id })
      .from(quickLinkTable)
      .where(
        and(
          ownQuickLinks(userId, workspaceId),
          eq(quickLinkTable.url, values.url),
          ne(quickLinkTable.id, id),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new HTTPException(409, { message: DUPLICATE_QUICK_LINK });
    }
  }

  const [updated] = await withDuplicateMapped(() =>
    db.update(quickLinkTable).set(values).where(own).returning(),
  );
  if (!updated) {
    throw new HTTPException(404, { message: QUICK_LINK_NOT_FOUND });
  }

  await publishQuickLinkChanged(userId, workspaceId, id, "updated");
  return toQuickLink(updated);
}

export default updateQuickLink;
