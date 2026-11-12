import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { calendarFeedTable } from "../../database/schema";

/** Deletes one of the caller's feeds; its URL answers 404 from now on. */
export default async function revokeCalendarFeed(userId: string, id: string) {
  const deleted = await db
    .delete(calendarFeedTable)
    .where(
      and(eq(calendarFeedTable.id, id), eq(calendarFeedTable.userId, userId)),
    )
    .returning({ id: calendarFeedTable.id });
  if (deleted.length === 0) {
    throw new HTTPException(404, { message: "Calendar feed not found" });
  }
  return { id };
}
