import { HTTPException } from "hono/http-exception";
import type { PoolClient } from "pg";
import { getDatabasePool } from "../database";

/**
 * One Jira import per project at a time, across API instances: two runs of
 * the same file would both miss each other's keys and create duplicates. A
 * session lock spans the import's many short transactions.
 */
export async function withJiraImportLock<T>(
  projectId: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockKey = `jira-import:${projectId}`;
  let client: PoolClient | undefined;
  let locked = false;
  let releaseError: Error | undefined;
  try {
    client = await getDatabasePool().connect();
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [lockKey],
    );
    locked = rows[0]?.acquired === true;
    if (!locked) {
      throw new HTTPException(409, {
        message:
          "Another Jira import into this project is running. Try again when it finishes.",
      });
    }
    return await run();
  } finally {
    if (client) {
      if (locked) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [lockKey],
          );
        } catch (error) {
          // Destroy a connection whose lock release was not confirmed.
          releaseError =
            error instanceof Error ? error : new Error("Lock release failed");
        }
      }
      client.release(releaseError);
    }
  }
}
