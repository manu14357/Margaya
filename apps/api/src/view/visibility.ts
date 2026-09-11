import { and, eq, or, type SQL } from "drizzle-orm";
import { savedViewTable } from "../database/schema";

/**
 * Views the user may see: shared ones, and private ones they own. Admins
 * follow the same rule, so nobody else's private view is ever returned
 * (lists, favorites, recent visits and direct reads alike).
 */
export function visibleViewCondition(userId: string): SQL {
  return or(
    eq(savedViewTable.access, "workspace"),
    and(
      eq(savedViewTable.access, "private"),
      eq(savedViewTable.ownerId, userId),
    ),
  ) as SQL;
}
