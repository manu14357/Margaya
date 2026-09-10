import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// pg_advisory_xact_lock class for a project's estimate systems. Project
// ordering uses 1524, favorites 1525 and module ordering 1526.
const ESTIMATE_LOCK = 1527;

export const ESTIMATE_BUSY = "Another estimate change is in progress; retry";
export const ESTIMATE_NAME_TAKEN =
  "An estimate system with this name already exists";

/**
 * Exclusive lock for writes to a project's estimate systems and points.
 * Every such write takes it first, so validation and the write it guards
 * can't interleave with another change.
 */
export async function lockProjectEstimates(tx: Transaction, projectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ESTIMATE_LOCK}, hashtext(${projectId}))`,
  );
}

/**
 * Shared lock for writes that set a task's estimate: they run side by side,
 * but never while a system or point change is remapping tasks, so a task
 * can't be set to a point that is being switched away or deleted.
 */
export async function shareProjectEstimates(
  tx: Transaction,
  projectId: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock_shared(${ESTIMATE_LOCK}, hashtext(${projectId}))`,
  );
}

function postgresError(
  error: unknown,
): { code?: unknown; constraint?: unknown } | null {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return typeof cause === "object" && cause !== null ? cause : null;
}

/**
 * Runs an estimate write in a transaction with a local statement timeout, so
 * a remap over a huge project can't hang the request. Timeouts become 503;
 * a lost race on the unique indexes becomes the usual 409.
 */
export async function estimateWrite<T>(
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '10s'`);
      return write(tx);
    });
  } catch (error) {
    const cause = postgresError(error);
    if (cause?.code === "57014") {
      throw new HTTPException(503, {
        message: "Estimate update took too long; retry later",
      });
    }
    if (cause?.code === "23505") {
      if (cause.constraint === "estimate_project_active_unique") {
        throw new HTTPException(409, { message: ESTIMATE_BUSY });
      }
      if (cause.constraint === "estimate_project_name_unique") {
        throw new HTTPException(409, { message: ESTIMATE_NAME_TAKEN });
      }
    }
    throw error;
  }
}

/** An HTTP error whose body is JSON, for errors that carry more than text. */
export function jsonHttpError(
  status: 400 | 409,
  body: { message: string } & Record<string, unknown>,
) {
  return new HTTPException(status, {
    message: body.message,
    res: new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=UTF-8" },
    }),
  });
}
