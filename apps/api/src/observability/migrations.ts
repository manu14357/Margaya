import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import db from "../database";

// The migration state for the health page: the migrations this build ships
// (drizzle/meta/_journal.json) against those the database recorded. Drizzle
// applies every shipped migration newer than the last one recorded, so
// "pending" counts those.

type JournalEntry = { idx: number; when: number; tag: string };

let cachedJournal: JournalEntry[] | null | undefined;

/** The journal next to this build: apps/api/drizzle in development and in the image. */
export function readMigrationJournal(): JournalEntry[] | null {
  if (cachedJournal !== undefined) return cachedJournal;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const file = join(dir, "drizzle", "meta", "_journal.json");
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as {
          entries?: JournalEntry[];
        };
        cachedJournal = Array.isArray(parsed.entries) ? parsed.entries : null;
      } catch {
        cachedJournal = null;
      }
      return cachedJournal;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedJournal = null;
  return cachedJournal;
}

export type MigrationState = {
  status: "ok" | "pending" | "unknown";
  /** Migrations recorded in the database. */
  applied: number;
  /** Migrations this build ships. */
  available: number;
  pending: number;
  /** The newest shipped migration the database has. */
  latest: string | null;
  latestAppliedAt: Date | null;
};

export function compareMigrations(
  journal: JournalEntry[] | null,
  applied: { count: number; lastCreatedAt: number | null },
): MigrationState {
  if (!journal) {
    return {
      status: "unknown",
      applied: applied.count,
      available: 0,
      pending: 0,
      latest: null,
      latestAppliedAt:
        applied.lastCreatedAt === null ? null : new Date(applied.lastCreatedAt),
    };
  }
  const last = applied.lastCreatedAt;
  const pending =
    last === null
      ? journal.length
      : journal.filter((entry) => entry.when > last).length;
  const latest =
    last === null
      ? null
      : ([...journal].reverse().find((entry) => entry.when <= last)?.tag ??
        null);
  return {
    status: pending > 0 ? "pending" : "ok",
    applied: applied.count,
    available: journal.length,
    pending,
    latest,
    latestAppliedAt: last === null ? null : new Date(last),
  };
}

export async function readMigrationState(): Promise<MigrationState> {
  let applied: { count: number; lastCreatedAt: number | null };
  try {
    const result = await db.execute<{ count: string; last: string | null }>(
      sql`select count(*)::text as count, max(created_at)::text as last from drizzle.__drizzle_migrations`,
    );
    const row = result.rows[0];
    applied = {
      count: Number(row?.count ?? 0),
      lastCreatedAt: row?.last ? Number(row.last) : null,
    };
  } catch {
    return {
      status: "unknown",
      applied: 0,
      available: readMigrationJournal()?.length ?? 0,
      pending: 0,
      latest: null,
      latestAppliedAt: null,
    };
  }
  return compareMigrations(readMigrationJournal(), applied);
}
