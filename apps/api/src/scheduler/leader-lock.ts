import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import db from "../database";

const INSTANCE_ID = randomUUID();
// A finished run keeps its lease under this owner for the hold period. Only
// this process may take it back early, so a lone instance runs exactly as
// often as before while other replicas skip the slot it already served.
const HELD_OWNER = `${INSTANCE_ID}:held`;

export const SEAT_RECONCILIATION_LEASE = "seat-reconciliation";

const DEFAULT_LEASE_MS = 15 * 60 * 1000;

// Half the interval: replicas whose crons fire for the same slot (seconds or
// even minutes apart) skip, while the next slot always finds the lease free.
export const HOURLY_JOB_HOLD_MS = 30 * 60 * 1000;
export const DAILY_JOB_HOLD_MS = 12 * 60 * 60 * 1000;

export type JobLeaseOptions = {
  /** How long a run may hold the lease before another instance takes over. */
  leaseMs?: number;
  /**
   * Keep the lease this long after the run started, counted from the claim,
   * instead of releasing it when the run ends. A failed run still releases.
   */
  holdMs?: number;
};

function millis(ms: number) {
  return sql`(${ms}::double precision * interval '1 millisecond')`;
}

export async function withJobLease<T>(
  name: string,
  run: () => Promise<T>,
  whenHeldElsewhere: () => T,
  leaseOrOptions: number | JobLeaseOptions = DEFAULT_LEASE_MS,
): Promise<T> {
  const options =
    typeof leaseOrOptions === "number"
      ? { leaseMs: leaseOrOptions }
      : leaseOrOptions;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const holdMs = options.holdMs;

  // Expiry is computed on the database clock so replicas with skewed clocks
  // (or a time zone other than the database session's) agree on it.
  const claimed = await db.execute(sql`
    INSERT INTO job_lease ("name", "owner", "expires_at")
    VALUES (${name}, ${INSTANCE_ID}, now() + ${millis(leaseMs)})
    ON CONFLICT ("name") DO UPDATE
      SET "owner" = EXCLUDED."owner", "expires_at" = EXCLUDED."expires_at"
      WHERE job_lease."expires_at" < now() OR job_lease."owner" = ${HELD_OWNER}
    RETURNING "name";
  `);

  if ((claimed.rowCount ?? 0) === 0) {
    return whenHeldElsewhere();
  }

  let succeeded = false;
  try {
    const result = await run();
    succeeded = true;
    return result;
  } finally {
    const release =
      succeeded && holdMs !== undefined && holdMs > 0
        ? // The claim set expires_at to claim time + leaseMs, so this moves it
          // to claim time + holdMs. A hold already in the past frees it.
          sql`UPDATE job_lease
              SET "owner" = ${HELD_OWNER},
                  "expires_at" = "expires_at" - ${millis(leaseMs)} + ${millis(holdMs)}
              WHERE "name" = ${name} AND "owner" = ${INSTANCE_ID};`
        : sql`DELETE FROM job_lease WHERE "name" = ${name} AND "owner" = ${INSTANCE_ID};`;
    await db.execute(release).catch((error) => {
      console.error(`Failed to release the ${name} lease`, error);
    });
  }
}
