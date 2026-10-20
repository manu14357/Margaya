import { and, desc, eq, ne } from "drizzle-orm";
import db from "../database";
import { activityTable, userTable } from "../database/schema";

// The history half of a task summary: what happened to the task (status,
// priority, assignee and other changes), oldest first. Comments are not
// here; loadTaskContext brings them with their authors.

/** Changes read back per summary; a long-lived task keeps its latest. */
export const TASK_HISTORY_LIMIT = 40;

const SCALAR_LIMIT = 120;

/** The event's scalar fields as `key: value`, short enough for a prompt. */
export function eventFacts(eventData: unknown): string {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(eventData)) {
    if (value === null || value === undefined || value === "") continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    // Ids mean nothing to the model; names and values do.
    if (/id$/i.test(key) || /ids$/i.test(key)) continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    parts.push(`${key}: ${text.slice(0, SCALAR_LIMIT)}`);
    if (parts.length >= 6) break;
  }
  return parts.join(", ");
}

export type HistoryRow = {
  type: string;
  createdAt: Date;
  actor: string | null;
  external: string | null;
  content: string | null;
  eventData: unknown;
};

/** One line per change: "2026-10-20 Alice status_changed (newStatus: done)". */
export function historyLine(row: HistoryRow): string {
  const who = row.actor ?? row.external ?? "Someone";
  const facts = eventFacts(row.eventData);
  const note = row.content?.replace(/\s+/g, " ").trim().slice(0, 200);
  return [
    row.createdAt.toISOString().slice(0, 10),
    who,
    row.type,
    facts ? `(${facts})` : null,
    note ? `— ${note}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The task's latest changes (not comments) as lines, oldest first. */
export async function taskHistoryLines(taskId: string): Promise<string[]> {
  const rows = await db
    .select({
      type: activityTable.type,
      createdAt: activityTable.createdAt,
      actor: userTable.name,
      external: activityTable.externalUserName,
      content: activityTable.content,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    .leftJoin(userTable, eq(userTable.id, activityTable.userId))
    .where(
      and(eq(activityTable.taskId, taskId), ne(activityTable.type, "comment")),
    )
    .orderBy(desc(activityTable.createdAt))
    .limit(TASK_HISTORY_LIMIT);
  return rows.reverse().map(historyLine);
}

export const TASK_SUMMARY_REQUEST =
  "Summarize where this task stands for someone catching up: one sentence on its current state, then short bold-labelled sections for what was decided, what is still open or blocked, and the next step, when the task, its comments and its history show them. Name people only as they appear in the data. Keep it under 150 words.";
