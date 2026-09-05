import { sql } from "drizzle-orm";
import type db from "../database";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Advisory lock namespaces, one per personal list, so different lists of the
// same user never wait on each other. Favorites use 1525.
export const LOCK_NAMESPACE = {
  sticky: 1526,
  quickLink: 1527,
  taskDraft: 1528,
  // Not a list: the per-requester cap on exports in progress.
  taskExport: 1529,
} as const;

/**
 * Serializes cap checks, position reads and renumbering of one user's list
 * in one workspace until the transaction ends.
 */
export async function lockUserWorkspaceList(
  tx: Transaction,
  namespace: number,
  userId: string,
  workspaceId: string,
) {
  const lockKey = `${userId}:${workspaceId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${namespace}::integer, hashtext(${lockKey}))`,
  );
}
