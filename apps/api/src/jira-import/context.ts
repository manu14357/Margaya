import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  activityTable,
  columnTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { findActiveEstimate, pointsOf } from "../estimate/queries";
import { MAX_IMPORT_TASKS } from "../task/import-extras";
import { readJiraCsv } from "./csv";
import { resolveTimeZone } from "./dates";
import { type JiraIssue, readIssues } from "./issues";
import type { ImportColumn, ImportMember } from "./mapping";
import { MAX_JIRA_FILE_BYTES } from "./schema";

export const JIRA_SOURCE = "jira";
/**
 * The activity row that records which Jira issue a task came from: its
 * external source is "jira" and its external URL holds the issue key (the
 * CSV has no issue URL). Re-imports find earlier tasks through it.
 */
export const IMPORTED_ACTIVITY = "imported";

export type JiraProject = typeof projectTable.$inferSelect;

/** Parses the uploaded export, enforcing the file and issue limits. */
export function parseJiraExport(content: string, timeZone: string | undefined) {
  if (Buffer.byteLength(content, "utf8") > MAX_JIRA_FILE_BYTES) {
    throw new HTTPException(413, {
      message: "The file is larger than 5 MiB. Export fewer issues per file.",
    });
  }
  const read = readJiraCsv(content);
  if (!read.ok) {
    throw new HTTPException(400, {
      message:
        read.error === "empty"
          ? "The file has no issues"
          : read.error === "notJira"
            ? "This isn't a Jira CSV export: it has no Summary column"
            : "This file can't be read as CSV",
    });
  }
  if (read.table.rows.length > MAX_IMPORT_TASKS) {
    throw new HTTPException(400, {
      message: `The file has more than ${MAX_IMPORT_TASKS.toLocaleString("en-US")} issues. Export fewer issues per file.`,
    });
  }
  const zone = resolveTimeZone(timeZone);
  return { ...readIssues(read.table, zone), timeZone: zone };
}

export async function loadJiraProject(projectId: string) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

export async function loadColumns(projectId: string): Promise<ImportColumn[]> {
  return db
    .select({
      slug: columnTable.slug,
      name: columnTable.name,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));
}

export async function loadMembers(
  workspaceId: string,
): Promise<ImportMember[]> {
  return db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
}

/** Issue key → task id, for keys imported into this project before. */
export async function loadImportedKeys(
  projectId: string,
  keys: readonly string[],
  source: string = JIRA_SOURCE,
): Promise<Map<string, string>> {
  const wanted = [...new Set(keys.filter(Boolean))];
  const found = new Map<string, string>();
  if (wanted.length === 0) return found;
  const rows = await db
    .select({ key: activityTable.externalUrl, taskId: activityTable.taskId })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(activityTable.type, IMPORTED_ACTIVITY),
        eq(activityTable.externalSource, source),
        inArray(activityTable.externalUrl, wanted),
      ),
    );
  for (const row of rows) if (row.key) found.set(row.key, row.taskId);
  return found;
}

export type EstimateLookup = {
  /** "points" reads Story Points, "time" the Original estimate. */
  reads: "points" | "time" | null;
  pointFor: (issue: JiraIssue) => string | null;
};

/**
 * Maps an issue to a point of the project's active estimate system: story
 * points to a points system, original estimates (seconds) to a time system
 * (minutes). Only exact values match; a category system takes neither.
 */
export async function loadEstimateLookup(
  project: JiraProject,
): Promise<EstimateLookup> {
  const none: EstimateLookup = { reads: null, pointFor: () => null };
  if (!project.estimatesEnabled) return none;
  const estimate = await findActiveEstimate(db, project.id);
  if (!estimate || estimate.type === "categories") return none;
  const points = await pointsOf(db, estimate.id);
  const byValue = new Map<number, string>();
  for (const point of points) {
    const value = Number(point.numericValue);
    if (point.numericValue !== null && Number.isFinite(value)) {
      if (!byValue.has(value)) byValue.set(value, point.id);
    }
  }
  const reads = estimate.type === "time" ? "time" : "points";
  return {
    reads,
    pointFor: (issue) => {
      const value =
        reads === "time"
          ? issue.originalEstimateSeconds === null
            ? null
            : issue.originalEstimateSeconds / 60
          : issue.storyPoints;
      return value === null ? null : (byValue.get(value) ?? null);
    },
  };
}
