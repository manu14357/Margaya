import { desc } from "drizzle-orm";
import db from "../../database";
import { quickLinkTable } from "../../database/schema";
import { ownQuickLinks, toQuickLink } from "./shared";

/** The caller's quick links, newest first (at most 50 by construction). */
async function listQuickLinks(userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(quickLinkTable)
    .where(ownQuickLinks(userId, workspaceId))
    .orderBy(desc(quickLinkTable.createdAt), desc(quickLinkTable.id));
  return rows.map(toQuickLink);
}

export default listQuickLinks;
