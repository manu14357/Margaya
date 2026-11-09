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
import { appVersion } from "../../utils/app-version";
import { isCloud } from "../../utils/is-cloud";

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
