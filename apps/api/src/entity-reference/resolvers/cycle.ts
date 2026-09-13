import { and, eq, inArray } from "drizzle-orm";
import { deriveCycleStatus } from "../../cycle/dates";
import db from "../../database";
import { cycleTable, projectTable } from "../../database/schema";
import { workspaceToday } from "../../utils/timezone";
import { type EntityResolver, type EntitySummary, trashedFlag } from "../types";

// Cycles are visible to every member of their workspace, so the caller only
// scopes the lookup to the workspace. The cycles feature gate is applied by
// the registry through `feature`.
export const resolveCycles: EntityResolver = async ({ workspaceId }, ids) => {
  const rows = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      archivedAt: cycleTable.archivedAt,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectArchivedAt: projectTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(cycleTable.projectId, projectTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(cycleTable.id, ids),
      ),
    );

  const today = await workspaceToday(workspaceId);
  return new Map(
    rows.map((cycle): [string, EntitySummary] => [
      cycle.id,
      {
        type: "cycle",
        id: cycle.id,
        name: cycle.name,
        key: null,
        icon: "IterationCw",
        projectId: cycle.projectId,
        projectName: cycle.projectName,
        isArchived:
          cycle.archivedAt !== null || cycle.projectArchivedAt !== null,
        ...trashedFlag(cycle.projectDeletedAt),
        feature: "cycles",
        details: {
          status: deriveCycleStatus(cycle, today),
          startDate: cycle.startDate,
          endDate: cycle.endDate,
        },
      },
    ]),
  );
};
