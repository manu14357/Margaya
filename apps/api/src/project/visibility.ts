// Restricted projects (PLAN 5.1). An "open" project is reached through
// workspace roles, as before. A "restricted" one only by its project members
// and by workspace owners and admins (and instance admins). Everything that
// decides whether someone may see a project goes through this module:
//   - `projectReach` answers for one project (lookups, WebSockets, jobs);
//   - `hiddenProjectIds` lists what a user may not see in a workspace, for
//     workspace-wide reads (lists, search, analytics, inbox...). It is empty,
//     and costs one indexed query, when the workspace has no restricted
//     project, so open workspaces never pay for a join.
// Someone who may not see a project gets 404, never 403, so its existence
// is not revealed.

import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { auditContext } from "../audit-log/context";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import {
  currentRequestUsesApiKey,
  instanceAdminApiKeysAllowed,
} from "../utils/admin-api-keys";

export const PROJECT_VISIBILITIES = ["open", "restricted"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const PROJECT_NOT_FOUND = "Project not found";

/** Workspace owners and admins see every project of their workspace. */
export function isWorkspaceManagerRole(role: string | null | undefined) {
  if (!role) return false;
  return role
    .split(",")
    .map((name) => name.trim())
    .some((name) => name === "owner" || name === "admin");
}

/**
 * Whether an instance admin's reach applies: their own session always, an
 * API key only when the operator allows it (admin-api-keys.ts).
 */
function instanceReach(userRole: string | null | undefined) {
  return (
    userRole === "admin" &&
    (!currentRequestUsesApiKey() || instanceAdminApiKeysAllowed())
  );
}

export type ProjectReach = {
  workspaceId: string;
  visibility: ProjectVisibility;
  /** May the user see the project at all (workspace access aside). */
  visible: boolean;
  /**
   * The project role that caps the user's rights there, or null when only
   * the workspace role counts (open project, owner, admin).
   */
  projectRole: string | null;
};

// Per-request memo: a request asks about the same project several times
// (middleware, permission checks, controllers).
const requestMemo = new WeakMap<object, Map<string, Promise<unknown>>>();

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const c = auditContext.getStore()?.c;
  if (!c) return load();
  let map = requestMemo.get(c);
  if (!map) {
    map = new Map();
    requestMemo.set(c, map);
  }
  const hit = map.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const promise = load();
  map.set(key, promise);
  promise.catch(() => map?.delete(key));
  return promise;
}

/** Forget memoized answers for this request (after a membership change). */
export function forgetProjectReach() {
  const c = auditContext.getStore()?.c;
  if (c) requestMemo.delete(c);
}

/**
 * How `userId` reaches `projectId`, or null when the project does not exist.
 * Workspace membership itself is checked by validateWorkspaceAccess.
 */
export function projectReach(
  userId: string,
  projectId: string,
): Promise<ProjectReach | null> {
  return memo(`reach:${userId}:${projectId}`, () =>
    loadProjectReach(userId, projectId),
  );
}

/**
 * Whether a live connection may keep receiving the project's events: the
 * project exists and is visible, and the user still belongs to its
 * workspace (or is an instance admin). Never memoized.
 */
export async function mayStayConnected(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const reach = await loadProjectReach(userId, projectId);
  return Boolean(reach?.visible && reach.inWorkspace);
}

async function loadProjectReach(
  userId: string,
  projectId: string,
): Promise<(ProjectReach & { inWorkspace: boolean }) | null> {
  const [row] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      visibility: projectTable.visibility,
      projectRole: projectMemberTable.role,
      workspaceRole: workspaceUserTable.role,
      userRole: userTable.role,
    })
    .from(projectTable)
    .leftJoin(
      projectMemberTable,
      and(
        eq(projectMemberTable.projectId, projectTable.id),
        eq(projectMemberTable.userId, userId),
      ),
    )
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .leftJoin(userTable, eq(userTable.id, userId))
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!row) return null;
  const visibility: ProjectVisibility =
    row.visibility === "restricted" ? "restricted" : "open";
  const inWorkspace = Boolean(row.workspaceRole) || instanceReach(row.userRole);
  if (
    visibility === "open" ||
    isWorkspaceManagerRole(row.workspaceRole) ||
    instanceReach(row.userRole)
  ) {
    return {
      workspaceId: row.workspaceId,
      visibility,
      visible: true,
      projectRole: null,
      inWorkspace,
    };
  }
  return {
    workspaceId: row.workspaceId,
    visibility,
    visible: Boolean(row.projectRole),
    projectRole: row.projectRole ?? null,
    inWorkspace,
  };
}

/** Whether `userId` may see the project; false for an unknown project. */
export async function canSeeProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const reach = await projectReach(userId, projectId);
  return Boolean(reach?.visible);
}

/** 404 unless `userId` may see the project. */
export async function assertProjectVisible(
  userId: string,
  projectId: string,
): Promise<void> {
  if (!(await canSeeProject(userId, projectId))) {
    throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
  }
}

/**
 * The restricted projects of a workspace that `userId` may not see. Empty
 * for owners, admins and instance admins, and in workspaces without a
 * restricted project. Includes trashed projects.
 */
export function hiddenProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  return memo(`hidden:${userId}:${workspaceId}`, async () => {
    const restricted = await db
      .select({ id: projectTable.id, memberId: projectMemberTable.userId })
      .from(projectTable)
      .leftJoin(
        projectMemberTable,
        and(
          eq(projectMemberTable.projectId, projectTable.id),
          eq(projectMemberTable.userId, userId),
        ),
      )
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          eq(projectTable.visibility, "restricted"),
        ),
      );
    const hidden = restricted
      .filter((row) => !row.memberId)
      .map((row) => row.id);
    if (hidden.length === 0) return [];

    const [who] = await db
      .select({
        workspaceRole: workspaceUserTable.role,
        userRole: userTable.role,
      })
      .from(userTable)
      .leftJoin(
        workspaceUserTable,
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          eq(workspaceUserTable.userId, userTable.id),
        ),
      )
      .where(eq(userTable.id, userId))
      .limit(1);
    if (
      who &&
      (isWorkspaceManagerRole(who.workspaceRole) || instanceReach(who.userRole))
    ) {
      return [];
    }
    return hidden;
  });
}

/**
 * Restricted projects hidden from `userId` across every workspace, for
 * reads that span workspaces (notification fan-out, digests).
 */
export async function hiddenProjectIdsAnywhere(
  userId: string,
  projectIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({
      id: projectTable.id,
      memberId: projectMemberTable.userId,
      workspaceRole: workspaceUserTable.role,
      userRole: userTable.role,
    })
    .from(projectTable)
    .leftJoin(
      projectMemberTable,
      and(
        eq(projectMemberTable.projectId, projectTable.id),
        eq(projectMemberTable.userId, userId),
      ),
    )
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .leftJoin(userTable, eq(userTable.id, userId))
    .where(
      and(
        inArray(projectTable.id, ids),
        eq(projectTable.visibility, "restricted"),
      ),
    );
  return new Set(
    rows
      .filter(
        (row) =>
          !row.memberId &&
          !isWorkspaceManagerRole(row.workspaceRole) &&
          !instanceReach(row.userRole),
      )
      .map((row) => row.id),
  );
}

/** The hidden projects for the request's user and workspace. */
export function requestHiddenProjectIds(c: Context): Promise<string[]> {
  const userId = c.get("userId") as string | undefined;
  const workspaceId = c.get("workspaceId") as string | undefined;
  if (!userId || !workspaceId) return Promise.resolve([]);
  return hiddenProjectIds(userId, workspaceId);
}

/**
 * A where-condition keeping rows whose project is not hidden, or undefined
 * when nothing is hidden (drizzle's `and()` drops it). With `nullable`, rows
 * without a project (workspace-level) are kept.
 */
export function notHiddenProject(
  column: Parameters<typeof notInArray>[0],
  hidden: readonly string[],
  options: { nullable?: boolean } = {},
): SQL | undefined {
  if (hidden.length === 0) return undefined;
  const condition = notInArray(column, [...hidden]);
  if (!options.nullable) return condition;
  return sql`(${isNull(column)} or ${condition})`;
}

/** Users of `userIds` who may see the project (for recipients, assignees). */
export async function usersWhoCanSeeProject(
  projectId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [project] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      visibility: projectTable.visibility,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return new Set();
  if (project.visibility !== "restricted") return new Set(ids);
  const rows = await db
    .select({
      userId: userTable.id,
      memberId: projectMemberTable.userId,
      workspaceRole: workspaceUserTable.role,
      userRole: userTable.role,
    })
    .from(userTable)
    .leftJoin(
      projectMemberTable,
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, userTable.id),
      ),
    )
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, project.workspaceId),
        eq(workspaceUserTable.userId, userTable.id),
      ),
    )
    .where(inArray(userTable.id, ids));
  return new Set(
    rows
      .filter(
        (row) =>
          Boolean(row.memberId) ||
          isWorkspaceManagerRole(row.workspaceRole) ||
          // Background fan-out has no request: an instance admin counts.
          row.userRole === "admin",
      )
      .map((row) => row.userId),
  );
}

/**
 * Raw SQL: the project `projectId` (a column or value) is visible to
 * `userId`, for queries that cannot take a precomputed hidden list
 * (notifications across workspaces, digests). Open projects pass; a
 * restricted one needs a project_member row or an owner or admin
 * workspace role.
 */
export function projectVisibleSql(
  projectId: SQLWrapper | string,
  userId: SQLWrapper | string,
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM project AS visibility_project
    WHERE visibility_project.id = ${projectId}
      AND visibility_project.visibility = 'restricted'
      AND NOT EXISTS (
        SELECT 1 FROM project_member AS visibility_member
        WHERE visibility_member.project_id = visibility_project.id
          AND visibility_member.user_id = ${userId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM workspace_member AS visibility_manager
        WHERE visibility_manager.workspace_id = visibility_project.workspace_id
          AND visibility_manager.user_id = ${userId}
          AND string_to_array(replace(visibility_manager.role, ' ', ''), ',')
            && ARRAY['owner', 'admin']::text[]
      )
  )`;
}

/**
 * The hidden projects of `workspaceId` for the user of the request in
 * flight, read from the request store, for controllers called without the
 * Hono context. Empty outside a request (internal jobs).
 */
export function hiddenForCurrentRequest(
  workspaceId: string,
): Promise<string[]> {
  const userId = auditContext.getStore()?.c?.get("userId") as
    | string
    | undefined;
  if (!userId) return Promise.resolve([]);
  return hiddenProjectIds(userId, workspaceId);
}
