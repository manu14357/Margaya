import pg from "pg";

/**
 * Create the database named in `databaseUrl` when it is missing. It connects to
 * the server's `postgres` maintenance database and only ever issues
 * CREATE DATABASE; it never drops or alters anything.
 */
export async function ensureDatabase(databaseUrl: string): Promise<boolean> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));

  if (!/^[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Refusing to create unexpected database "${databaseName}"`);
  }

  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return false;
    }
    try {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    } catch (error) {
      // Another process created it between the check and the create.
      if ((error as { code?: string }).code !== "42P04") {
        throw error;
      }
      return false;
    }
    return true;
  } finally {
    await client.end();
  }
}

/**
 * Drop and recreate the e2e database, for when migrations changed under an
 * existing one. Hard-wired to margaya_e2e so it can never touch margaya_dev or
 * margaya_test. FORCE disconnects a running e2e API.
 */
export async function resetE2eDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (databaseName !== "margaya_e2e") {
    throw new Error(`Refusing to reset "${databaseName}": only margaya_e2e`);
  }

  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query('DROP DATABASE IF EXISTS "margaya_e2e" WITH (FORCE)');
    await client.query('CREATE DATABASE "margaya_e2e"');
  } finally {
    await client.end();
  }
}
