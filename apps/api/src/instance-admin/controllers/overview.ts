import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { count, isNotNull, sql } from "drizzle-orm";
import db from "../../database";
import {
  projectPublicationTable,
  projectTable,
  userTable,
  workspaceTable,
} from "../../database/schema";
import { getInstanceSettings } from "../../instance-settings/snapshot";
import { isRedisConfigured, resolveRedisMode } from "../../redis";
import { isCloud } from "../../utils/is-cloud";

let cachedVersion: string | null = null;

// The nearest package.json above this module that carries a version: the
// workspace root in development and in the bundled image alike.
function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const version = JSON.parse(readFileSync(file, "utf8")).version;
        if (typeof version === "string") {
          cachedVersion = version;
          return version;
        }
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedVersion = "unknown";
  return cachedVersion;
}

function isSet(name: string) {
  return Boolean(process.env[name]?.trim());
}

function realtimeMode() {
  if (!isRedisConfigured()) return "memory" as const;
  try {
    return resolveRedisMode().mode;
  } catch {
    return "memory" as const;
  }
}

export async function getInstanceOverview() {
  const settings = getInstanceSettings();
  const [users, workspaces, projects, boards] = await Promise.all([
    db
      .select({
        accounts: sql<number>`count(*) filter (where ${userTable.isAnonymous} is not true)`,
        guests: sql<number>`count(*) filter (where ${userTable.isAnonymous} is true)`,
      })
      .from(userTable),
    db.select({ value: count() }).from(workspaceTable),
    db.select({ value: count() }).from(projectTable),
    db
      .select({ value: count() })
      .from(projectPublicationTable)
      .where(isNotNull(projectPublicationTable.publishedAt)),
  ]);

  return {
    instanceName: settings.effective.instanceName,
    version: appVersion(),
    counts: {
      accounts: Number(users[0]?.accounts ?? 0),
      guests: Number(users[0]?.guests ?? 0),
      workspaces: Number(workspaces[0]?.value ?? 0),
      projects: Number(projects[0]?.value ?? 0),
      publishedBoards: Number(boards[0]?.value ?? 0),
    },
    server: {
      realtime: realtimeMode(),
      email: settings.derived.smtpConfigured,
      fileStorage: isSet("S3_ENDPOINT") && isSet("S3_BUCKET"),
      captcha: isSet("TURNSTILE_SECRET_KEY"),
      errorReporting: isSet("SENTRY_DSN"),
      cloudMode: isCloud(),
      demoMode: process.env.DEMO_MODE === "true",
    },
    settingsLocked: settings.locked,
  };
}
