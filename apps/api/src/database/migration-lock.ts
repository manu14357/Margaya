import type { Client } from "pg";

// One key for every Margaya instance on the database. hashtextextended turns
// it into the bigint pg_advisory_lock takes.
export const STARTUP_MIGRATION_LOCK = "margaya:startup-migrations";

type LockClient = Pick<Client, "query" | "end">;

/**
 * Runs startup migrations while holding a session advisory lock. A lone
 * instance takes the lock at once; a replica starting alongside waits until
 * the first has finished and then finds nothing pending. If the holder dies,
 * PostgreSQL drops its session and with it the lock.
 *
 * The lock lives on a connection outside the pool, so a small
 * DATABASE_POOL_MAX still leaves room for migrations that use the pool. The
 * same connection is handed to `run` with no statement timeout, for SQL
 * migrations such as index builds that may take longer than the pool allows.
 */
export async function withStartupMigrationLock<T, C extends LockClient>(
  connect: () => Promise<C>,
  run: (client: C) => Promise<T>,
  logInfo: (message: string) => void = console.log,
): Promise<T> {
  const client = await connect();
  try {
    await client.query("SET statement_timeout = 0");
    const attempt = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [STARTUP_MIGRATION_LOCK],
    );
    if (!attempt.rows[0]?.locked) {
      logInfo(
        "⏳ Another instance is migrating the database; waiting for it to finish",
      );
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        STARTUP_MIGRATION_LOCK,
      ]);
    }
    return await run(client);
  } finally {
    // Ending the session releases the lock, also after a failed migration.
    await client.end().catch((error: unknown) => {
      console.error("Failed to close the migration lock connection", error);
    });
  }
}
