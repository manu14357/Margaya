import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { visibleViewCondition } from "../access";
import {
  type SavedViewResponse,
  selectViews,
  toSavedView,
  type ViewCaller,
} from "./shared";

export const MAX_LISTED_VIEWS = 1000;

const nameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * A project's views, or the workspace views (no project), that the caller
 * can see: shared ones plus their own private ones. Ordered by name
 * (natural, case-insensitive), then newest first.
 */
async function listViews({
  workspaceId,
  projectId,
  mine,
  search,
  caller,
}: {
  workspaceId: string;
  projectId: string | null;
  mine: boolean;
  search?: string;
  caller: ViewCaller;
}): Promise<SavedViewResponse[]> {
  // Private views whose owner's account is gone can never be seen again.
  await db
    .delete(savedViewTable)
    .where(
      and(
        eq(savedViewTable.workspaceId, workspaceId),
        eq(savedViewTable.access, "private"),
        isNull(savedViewTable.ownerId),
      ),
    );

  const rows = await selectViews(
    db,
    and(
      eq(savedViewTable.workspaceId, workspaceId),
      projectId
        ? eq(savedViewTable.projectId, projectId)
        : isNull(savedViewTable.projectId),
      visibleViewCondition(caller.userId),
      mine ? eq(savedViewTable.ownerId, caller.userId) : undefined,
      search
        ? ilike(savedViewTable.name, `%${escapeLikePattern(search)}%`)
        : undefined,
    ),
    {
      orderBy: [
        asc(sql`lower(${savedViewTable.name})`),
        desc(savedViewTable.createdAt),
        asc(savedViewTable.id),
      ],
      limit: MAX_LISTED_VIEWS,
    },
  );

  return rows
    .map((row) => toSavedView(row, caller))
    .sort(
      (a, b) =>
        nameCollator.compare(a.name, b.name) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export default listViews;
