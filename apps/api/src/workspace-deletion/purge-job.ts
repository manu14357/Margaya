import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import db from "../database";
import { assetTable, workspaceTable } from "../database/schema";
import { recordInstanceAudit } from "../instance-admin/audit";
import { withJobLease } from "../scheduler/leader-lock";
import { deleteS3Keys } from "../storage/cleanup-assets";
import { purgeWorkspaceExports } from "../task-export/storage";

// Hourly, on one instance at a time: workspaces whose grace period is over
// are deleted for good. Each delete re-checks the due date in its WHERE
// clause, so a deletion cancelled meanwhile is left alone and a second run
// finds nothing to do. Rows cascade with the workspace; stored files don't,
// so they are removed afterwards (best effort). The instance audit trail
// keeps a record of the purge.

export const WORKSPACE_DELETION_LEASE = "workspace-deletion-purge";
const LEASE_MS = 10 * 60 * 1000;
const BATCH = 20;
const FILE_BATCH = 50;

export type WorkspacePurgeOutcome = { degraded: boolean; purged: number };

async function purgeWorkspace(
  workspace: { id: string; name: string; dueAt: Date | null },
  now: Date,
): Promise<boolean> {
  await purgeWorkspaceExports(workspace.id).catch((error) => {
    console.error("Export cleanup before workspace purge failed", error);
  });
  const assets = await db
    .select({ objectKey: assetTable.objectKey })
    .from(assetTable)
    .where(eq(assetTable.workspaceId, workspace.id));

  const [deleted] = await db
    .delete(workspaceTable)
    .where(
      and(
        eq(workspaceTable.id, workspace.id),
        isNotNull(workspaceTable.deletionDueAt),
        lte(workspaceTable.deletionDueAt, now),
      ),
    )
    .returning({ id: workspaceTable.id });
  if (!deleted) return false;

  const keys = assets.map((asset) => asset.objectKey);
  for (let start = 0; start < keys.length; start += FILE_BATCH) {
    await deleteS3Keys(keys.slice(start, start + FILE_BATCH)).catch((error) => {
      console.error("Stored files of a purged workspace remain", error);
    });
  }
  await recordInstanceAudit({
    action: "workspace.purged",
    target: { type: "workspace", id: workspace.id, label: workspace.name },
    metadata: { dueAt: workspace.dueAt?.toISOString() ?? null },
    actor: { system: true },
  });
  return true;
}

async function purgeDue(now: Date): Promise<WorkspacePurgeOutcome> {
  const outcome: WorkspacePurgeOutcome = { degraded: false, purged: 0 };
  const due = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      dueAt: workspaceTable.deletionDueAt,
    })
    .from(workspaceTable)
    .where(
      and(
        isNotNull(workspaceTable.deletionDueAt),
        lte(workspaceTable.deletionDueAt, now),
      ),
    )
    .orderBy(asc(workspaceTable.deletionDueAt))
    .limit(BATCH);
  for (const workspace of due) {
    try {
      if (await purgeWorkspace(workspace, now)) outcome.purged += 1;
    } catch (error) {
      outcome.degraded = true;
      console.error(
        `workspace deletion: purge of ${workspace.id} failed`,
        error,
      );
    }
  }
  if (outcome.purged > 0) {
    console.log(`workspace deletion: purged ${outcome.purged} workspaces`);
  }
  return outcome;
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runWorkspaceDeletionPurge(
  now: Date = new Date(),
): Promise<WorkspacePurgeOutcome> {
  return withJobLease(
    WORKSPACE_DELETION_LEASE,
    () => purgeDue(now),
    () => ({ degraded: false, purged: 0 }),
    LEASE_MS,
  );
}
