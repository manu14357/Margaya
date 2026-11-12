import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  calendarFeedTable,
  projectTable,
  workspaceUserTable,
} from "../../database/schema";
import { publicApiUrl } from "../../utils/desktop-config";
import { feedTokenStart, generateFeedToken, hashFeedToken } from "../token";
import listCalendarFeeds from "./list-calendar-feeds";

export type CreateCalendarFeedInput =
  | { kind: "my_tasks" | "planning"; name: string }
  | { kind: "project"; projectId: string; name: string };

/** The https subscription URL and its webcal twin for a token. */
export function feedUrls(token: string) {
  const url = `${publicApiUrl()}/api/calendar-feed/${token}/feed.ics`;
  return { url, webcalUrl: url.replace(/^https?:/, "webcal:") };
}

/**
 * Creates the caller's feed for a scope, or regenerates its token when it
 * exists: the old URL stops working at once. The URL is returned only here.
 */
export default async function createCalendarFeed(
  userId: string,
  workspaceId: string,
  input: CreateCalendarFeedInput,
) {
  // Feeds are personal to members. Instance admins reach workspaces they
  // are not in, but a feed of one would only ever answer 404.
  const [member] = await db
    .select({ id: workspaceUserTable.id })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new HTTPException(403, {
      message: "Only workspace members can subscribe to its calendar feeds",
    });
  }

  const projectId = input.kind === "project" ? input.projectId : null;
  if (projectId) {
    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
  }

  const token = generateFeedToken();
  const values = {
    userId,
    workspaceId,
    projectId,
    kind: input.kind,
    name: input.name,
    tokenHash: hashFeedToken(token),
    tokenStart: feedTokenStart(token),
  };
  const regenerated = {
    name: values.name,
    tokenHash: values.tokenHash,
    tokenStart: values.tokenStart,
    createdAt: new Date(),
    lastUsedAt: null,
  };
  const [row] = projectId
    ? await db
        .insert(calendarFeedTable)
        .values(values)
        .onConflictDoUpdate({
          target: [calendarFeedTable.userId, calendarFeedTable.projectId],
          targetWhere: sql`${calendarFeedTable.projectId} is not null`,
          set: regenerated,
        })
        .returning({ id: calendarFeedTable.id })
    : await db
        .insert(calendarFeedTable)
        .values(values)
        .onConflictDoUpdate({
          target: [
            calendarFeedTable.userId,
            calendarFeedTable.workspaceId,
            calendarFeedTable.kind,
          ],
          targetWhere: sql`${calendarFeedTable.projectId} is null`,
          set: regenerated,
        })
        .returning({ id: calendarFeedTable.id });
  if (!row) throw new HTTPException(500, { message: "Feed not saved" });

  const summary = (await listCalendarFeeds(userId, workspaceId)).find(
    (feed) => feed.id === row.id,
  );
  if (!summary) throw new HTTPException(500, { message: "Feed not found" });
  return { ...summary, ...feedUrls(token) };
}
