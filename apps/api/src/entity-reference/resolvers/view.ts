import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { projectTable, savedViewTable } from "../../database/schema";
import { readViewDisplay } from "../../view/normalize";
import { visibleViewCondition } from "../../view/visibility";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

// Saved views, for the calling user only: someone else's private view never
// resolves, so it can't be favorited or recorded, and reads as deleted. The
// views feature gate applies to project views through `feature`.
export const resolveViews: EntityResolver = async (
  { workspaceId, userId },
  ids,
) => {
  const rows = await db
    .select({
      id: savedViewTable.id,
      name: savedViewTable.name,
      access: savedViewTable.access,
      isLocked: savedViewTable.isLocked,
      ownerId: savedViewTable.ownerId,
      display: savedViewTable.display,
      projectId: savedViewTable.projectId,
      projectName: projectTable.name,
      projectArchivedAt: projectTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(savedViewTable)
    .leftJoin(
      projectTable,
      and(
        eq(projectTable.id, savedViewTable.projectId),
        eq(projectTable.workspaceId, savedViewTable.workspaceId),
      ),
    )
    .where(
      and(
        eq(savedViewTable.workspaceId, workspaceId),
        inArray(savedViewTable.id, ids),
        visibleViewCondition(userId),
      ),
    );

  return new Map(
    rows.map((view): [string, EntitySummary] => [
      view.id,
      {
        type: "view",
        id: view.id,
        name: view.name,
        key: null,
        icon: "Layers",
        projectId: view.projectId,
        projectName: view.projectName,
        isArchived: view.projectArchivedAt !== null,
        ...trashedFlag(view.projectDeletedAt),
        feature: view.projectId ? "views" : null,
        details: {
          access: view.access,
          layout: readViewDisplay(
            view.display,
            view.projectId ? "project" : "workspace",
          ).layout,
          isLocked: view.isLocked,
          ownerId: view.ownerId,
        },
      },
    ]),
  );
};
