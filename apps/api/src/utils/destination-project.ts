import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, taskTable } from "../database/schema";
import { validateWorkspaceAccess } from "./validate-workspace-access";

// Route middleware runs before the validators, so c.req.valid() is unavailable.
export async function readJsonBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/**
 * A request can act on a second project: a task or page moving there, a label
 * going on one of its tasks. It must be a project this caller (and a
 * project-limited API key) reaches in the workspace, or it reads as missing.
 * Listing it among the request's projects makes the permission check that
 * follows apply its project role too, next to the first project's.
 */
export async function includeDestinationProject(c: Context, projectId: string) {
  await validateWorkspaceAccess(
    c.get("userId"),
    c.get("workspaceId"),
    c.get("apiKey")?.id,
    projectId,
  );
  const source = c.get("projectId") as string | null | undefined;
  const sources: string[] = c.get("projectIds") ?? (source ? [source] : []);
  c.set("projectIds", [...new Set([...sources, projectId])]);
}

/**
 * The destination project named by a body field goes through that check. Place
 * between `workspaceAccess` and `requireWorkspacePermission`. A missing or
 * malformed id is left to the validator, or means the resource's own project.
 */
export function includeBodyDestination(field: string) {
  return async (c: Context, next: Next) => {
    const value = (await readJsonBody(c))[field];
    if (typeof value === "string" && value) {
      await includeDestinationProject(c, value);
    }
    return next();
  };
}

/**
 * The same for a task named by a body field: its project is the destination.
 * A task out of reach reads as missing; an unknown one, or another workspace's,
 * is left for the controller to answer.
 */
export function includeBodyTaskProject(field = "taskId") {
  return async (c: Context, next: Next) => {
    const taskId = (await readJsonBody(c))[field];
    if (typeof taskId !== "string" || !taskId) return next();
    const [task] = await db
      .select({ projectId: taskTable.projectId })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, taskId),
          eq(projectTable.workspaceId, c.get("workspaceId")),
        ),
      )
      .limit(1);
    if (!task) return next();
    try {
      await includeDestinationProject(c, task.projectId);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 404) {
        throw new HTTPException(404, { message: "Task not found" });
      }
      throw error;
    }
    return next();
  };
}
