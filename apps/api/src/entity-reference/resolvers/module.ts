import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { moduleTable, projectTable } from "../../database/schema";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

// Modules are visible to every member of their workspace, so the caller only
// scopes the lookup to the workspace. The modules feature gate is applied by
// the registry through `feature`.
export const resolveModules: EntityResolver = async ({ workspaceId }, ids) => {
  const rows = await db
    .select({
      id: moduleTable.id,
      name: moduleTable.name,
      status: moduleTable.status,
      startDate: moduleTable.startDate,
      targetDate: moduleTable.targetDate,
      archivedAt: moduleTable.archivedAt,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectArchivedAt: projectTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(moduleTable)
    .innerJoin(projectTable, eq(moduleTable.projectId, projectTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(moduleTable.id, ids),
      ),
    );

  return new Map(
    rows.map((found): [string, EntitySummary] => [
      found.id,
      {
        type: "module",
        id: found.id,
        name: found.name,
        key: null,
        icon: "Boxes",
        projectId: found.projectId,
        projectName: found.projectName,
        isArchived:
          found.archivedAt !== null || found.projectArchivedAt !== null,
        ...trashedFlag(found.projectDeletedAt),
        feature: "modules",
        details: {
          status: found.status,
          startDate: found.startDate,
          targetDate: found.targetDate,
        },
      },
    ]),
  );
};
