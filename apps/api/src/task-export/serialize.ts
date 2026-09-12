import { sql } from "drizzle-orm";
import db from "../database";
import { projectTable, userTable } from "../database/schema";
import { textArray } from "../task-query/context";
import type { TaskExportRow } from "./job";
import type { TaskExportResponse } from "./response";

/** API responses for these rows, with two lookups however many rows. */
export async function toTaskExportResponses(
  rows: readonly TaskExportRow[],
  now: Date = new Date(),
): Promise<TaskExportResponse[]> {
  const projectIds = [...new Set(rows.flatMap((row) => row.projectIds))];
  const userIds = [...new Set(rows.flatMap((row) => row.requestedBy ?? []))];
  const projects =
    projectIds.length > 0
      ? await db
          .select({
            id: projectTable.id,
            name: projectTable.name,
            slug: projectTable.slug,
            workspaceId: projectTable.workspaceId,
          })
          .from(projectTable)
          .where(sql`${projectTable.id} = any(${textArray(projectIds)})`)
      : [];
  const users =
    userIds.length > 0
      ? await db
          .select({
            id: userTable.id,
            name: userTable.name,
            image: userTable.image,
          })
          .from(userTable)
          .where(sql`${userTable.id} = any(${textArray(userIds)})`)
      : [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const userById = new Map(users.map((user) => [user.id, user]));

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    format: row.format,
    projectIds: row.projectIds,
    projects: row.projectIds.flatMap((id) => {
      const project = projectById.get(id);
      return project && project.workspaceId === row.workspaceId
        ? [{ id: project.id, name: project.name, slug: project.slug }]
        : [];
    }),
    splitByProject: row.splitByProject,
    includeArchived: row.includeArchived,
    status: row.status,
    error: row.error,
    taskCount: row.taskCount,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    requestedBy: row.requestedBy
      ? (userById.get(row.requestedBy) ?? null)
      : null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    downloadable: isDownloadable(row, now),
  }));
}

export function isDownloadable(
  row: Pick<TaskExportRow, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  return (
    row.status === "completed" &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() > now.getTime()
  );
}

export async function toTaskExportResponse(
  row: TaskExportRow,
): Promise<TaskExportResponse> {
  const [response] = await toTaskExportResponses([row]);
  if (!response) throw new Error("Export response missing");
  return response;
}
