import { and, count, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { isBillingEnabled } from "../billing/config";
import { syncWorkspaceSeats } from "../billing/controllers/sync-seats";
import db from "../database";
import {
  userTable,
  workspaceBillingTable,
  workspaceUserTable,
} from "../database/schema";
import {
  HOURLY_JOB_HOLD_MS,
  SEAT_RECONCILIATION_LEASE,
  withJobLease,
} from "./leader-lock";

const BATCH_SIZE = 100;

// Agents are workspace members but never seats.
async function findDriftedWorkspaces() {
  return db
    .select({ workspaceId: workspaceBillingTable.workspaceId })
    .from(workspaceBillingTable)
    .innerJoin(
      workspaceUserTable,
      eq(workspaceUserTable.workspaceId, workspaceBillingTable.workspaceId),
    )
    .innerJoin(
      userTable,
      and(
        eq(userTable.id, workspaceUserTable.userId),
        ne(userTable.kind, "agent"),
      ),
    )
    .where(
      and(
        eq(workspaceBillingTable.plan, "team"),
        inArray(workspaceBillingTable.status, ["active", "trialing"]),
        isNotNull(workspaceBillingTable.creemSubscriptionId),
        isNotNull(workspaceBillingTable.creemProductId),
      ),
    )
    .groupBy(workspaceBillingTable.workspaceId, workspaceBillingTable.seats)
    .having(
      sql`${count(workspaceUserTable.userId)} <> ${workspaceBillingTable.seats}`,
    )
    .limit(BATCH_SIZE);
}

export async function reconcileWorkspaceSeats(): Promise<{
  degraded: boolean;
}> {
  if (!isBillingEnabled()) {
    return { degraded: false };
  }

  return withJobLease(
    SEAT_RECONCILIATION_LEASE,
    runReconciliation,
    () => ({ degraded: false }),
    { holdMs: HOURLY_JOB_HOLD_MS },
  );
}

async function runReconciliation(): Promise<{ degraded: boolean }> {
  let drifted: Awaited<ReturnType<typeof findDriftedWorkspaces>>;
  try {
    drifted = await findDriftedWorkspaces();
  } catch (error) {
    console.error("billing: seat reconciliation query failed", error);
    return { degraded: true };
  }

  if (drifted.length === 0) {
    return { degraded: false };
  }

  let repaired = 0;
  let degraded = false;
  for (const { workspaceId } of drifted) {
    try {
      await syncWorkspaceSeats(workspaceId);
      repaired += 1;
    } catch (error) {
      degraded = true;
      console.error(
        `billing: seat reconciliation failed for workspace ${workspaceId}`,
        error,
      );
    }
  }

  console.log(
    `billing: seat reconciliation resynced ${repaired}/${drifted.length} workspaces`,
  );
  return { degraded };
}
