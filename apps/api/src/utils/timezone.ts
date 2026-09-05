// IANA time zones. Workspaces own the zone that defines "today" for
// server-side date logic; users own the zone used for times rendered for
// them (reminders, digests). Both fall back to UTC, which reproduces the
// behaviour from before time zones existed. The pure date helpers live in
// zoned-date.ts and are re-exported here.

import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { resolveTimezone, todayInTimezone } from "./zoned-date";

export {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  type LocalParts,
  localDateString,
  localDateTimeParts,
  normalizeTimezone,
  resolveTimezone,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  todayInTimezone,
  zonedTimeToUtc,
} from "./zoned-date";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or an open transaction. */
type Reader = Pick<Transaction, "select">;

export async function getWorkspaceTimezone(
  workspaceId: string,
  reader: Reader = db,
): Promise<string> {
  const [row] = await reader
    .select({ timezone: schema.workspaceTable.timezone })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .limit(1);
  return resolveTimezone(row?.timezone);
}

/** The zone of the workspace that owns `projectId` (UTC if unknown). */
export async function getProjectTimezone(
  projectId: string,
  reader: Reader = db,
): Promise<string> {
  const [row] = await reader
    .select({ timezone: schema.workspaceTable.timezone })
    .from(schema.projectTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
    )
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  return resolveTimezone(row?.timezone);
}

/** Today's date for the workspace that owns `projectId`. */
export async function projectToday(
  projectId: string,
  reader: Reader = db,
  now: Date = new Date(),
): Promise<string> {
  return todayInTimezone(await getProjectTimezone(projectId, reader), now);
}

/** Today's date for `workspaceId`. */
export async function workspaceToday(
  workspaceId: string,
  reader: Reader = db,
  now: Date = new Date(),
): Promise<string> {
  return todayInTimezone(await getWorkspaceTimezone(workspaceId, reader), now);
}

/** The user's chosen zone, or UTC when they have not set one. */
export async function getUserTimezone(userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: schema.userTable.timezone })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
  return resolveTimezone(row?.timezone);
}
