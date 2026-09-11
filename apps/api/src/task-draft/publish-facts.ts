import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  columnTable,
  customFieldDefinitionTable,
  cycleTable,
  estimatePointTable,
  estimateTable,
  moduleTable,
  projectTable,
} from "../database/schema";
import type { Transaction } from "../task/assignee-writes";
import { filterAssignableUsers } from "../utils/assert-assignable-user";
import { workspaceToday } from "../utils/timezone";
import type { DraftValues } from "./normalize";
import type { PublishFacts } from "./publish-plan";

export type PublishProject = {
  id: string;
  workspaceId: string;
  slug: string;
  archivedAt: Date | null;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
};

export async function loadPublishProject(
  tx: Transaction,
  projectId: string,
  workspaceId: string,
): Promise<PublishProject | null> {
  const [project] = await tx
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
      slug: projectTable.slug,
      archivedAt: projectTable.archivedAt,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        // A trashed project reads as gone (C7).
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

async function loadCycle(tx: Transaction, cycleId: string, projectId: string) {
  const [cycle] = await tx
    .select({
      archivedAt: cycleTable.archivedAt,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
    })
    .from(cycleTable)
    .where(and(eq(cycleTable.id, cycleId), eq(cycleTable.projectId, projectId)))
    .limit(1);
  return cycle ?? null;
}

async function loadActiveModuleIds(
  tx: Transaction,
  moduleIds: readonly string[],
  projectId: string,
) {
  if (moduleIds.length === 0) return new Set<string>();
  const rows = await tx
    .select({ id: moduleTable.id })
    .from(moduleTable)
    .where(
      and(
        inArray(moduleTable.id, [...moduleIds]),
        eq(moduleTable.projectId, projectId),
        isNull(moduleTable.archivedAt),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

async function isPointActive(
  tx: Transaction,
  pointId: string,
  projectId: string,
) {
  const [point] = await tx
    .select({ id: estimatePointTable.id })
    .from(estimatePointTable)
    .innerJoin(
      estimateTable,
      eq(estimateTable.id, estimatePointTable.estimateId),
    )
    .where(
      and(
        eq(estimatePointTable.id, pointId),
        eq(estimateTable.projectId, projectId),
        eq(estimateTable.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(point);
}

/** Everything buildPublishPlan needs, read inside the publish transaction. */
export async function loadPublishFacts(
  tx: Transaction,
  draft: DraftValues,
  project: PublishProject,
): Promise<PublishFacts> {
  // One transaction client: queries run one after another.
  const columns = await tx
    .select({
      slug: columnTable.slug,
      position: columnTable.position,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, project.id),
        ne(columnTable.group, "triage"),
      ),
    );
  const fields = await tx
    .select({ id: customFieldDefinitionTable.id })
    .from(customFieldDefinitionTable)
    .where(eq(customFieldDefinitionTable.projectId, project.id));
  const assignableIds = await filterAssignableUsers(
    draft.assigneeIds,
    project.workspaceId,
    tx,
  );

  return {
    today: await workspaceToday(project.workspaceId, tx),
    columns,
    assignableIds,
    fieldIds: new Set(fields.map((field) => field.id)),
    features: {
      cycles: project.cyclesEnabled,
      modules: project.modulesEnabled,
      estimates: project.estimatesEnabled,
    },
    cycle: draft.cycleId
      ? await loadCycle(tx, draft.cycleId, project.id)
      : null,
    activeModuleIds: await loadActiveModuleIds(tx, draft.moduleIds, project.id),
    pointActive: draft.estimatePointId
      ? await isPointActive(tx, draft.estimatePointId, project.id)
      : false,
  };
}
