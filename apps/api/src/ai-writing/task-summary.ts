import { and, desc, eq, ne } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import db from "../database";
import { activityTable, taskTable, userTable } from "../database/schema";
import { hiddenForCurrentRequest } from "../project/visibility";
import { redactActivityRowsBy } from "../task-activity/redact";

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

/**
 * The task's latest changes (not comments) as lines, oldest first. A row can
 * name another project; the prompt only names one AI may read for this caller.
 * The call takes its data tier from the task, so a restricted project is only
 * named in its own tasks: anywhere else it would go out as private data.
 */
export async function taskHistoryLines(
  taskId: string,
  scope: Pick<AiScope, "workspaceId" | "projectIds" | "restrictedProjectIds">,
): Promise<string[]> {
  const [rows, hidden] = await Promise.all([
    db
      .select({
        type: activityTable.type,
        createdAt: activityTable.createdAt,
        actor: userTable.name,
        external: activityTable.externalUserName,
        content: activityTable.content,
        eventData: activityTable.eventData,
        taskId: activityTable.taskId,
        taskProjectId: taskTable.projectId,
      })
      .from(activityTable)
      .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
      .leftJoin(userTable, eq(userTable.id, activityTable.userId))
      .where(
        and(
          eq(activityTable.taskId, taskId),
          ne(activityTable.type, "comment"),
        ),
      )
      .orderBy(desc(activityTable.createdAt))
      .limit(TASK_HISTORY_LIMIT),
    hiddenForCurrentRequest(scope.workspaceId),
  ]);
  const taskProjectId = rows[0]?.taskProjectId;
  const redacted = await redactActivityRowsBy(
    rows,
    (projectId) =>
      scope.projectIds.has(projectId) &&
      !hidden.includes(projectId) &&
      (!scope.restrictedProjectIds.has(projectId) ||
        projectId === taskProjectId),
  );
  return redacted.reverse().map(historyLine);
}

export const TASK_SUMMARY_REQUEST =
  "Summarize where this task stands for someone catching up: one sentence on its current state, then short bold-labelled sections for what was decided, what is still open or blocked, and the next step, when the task, its comments and its history show them. Name people only as they appear in the data. Keep it under 150 words.";
