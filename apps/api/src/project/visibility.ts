// Restricted projects (PLAN 5.1). An "open" project is reached through
// workspace roles, as before. A "restricted" one only by its project members
// and by workspace owners and admins (and instance admins). A workspace guest
// is a project member or nothing: every project they were not added to is
// hidden from them, open or not. Everything that decides whether someone may
// see a project goes through this module:
//   - `projectReach` answers for one project (lookups, WebSockets, jobs);
//   - `hiddenProjectIds` lists what a user may not see in a workspace, for
//     workspace-wide reads (lists, search, analytics, inbox...). It costs
//     one indexed query, and is empty when the workspace has no restricted
//     project and the user is not a guest.
// Someone who may not see a project gets 404, never 403, so its existence
// is not revealed.

import { isGuestRole } from "@margaya/permissions";
import {
  and,
  asc,
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
import { currentRequestApiKey } from "../api-key/scope";
import { auditContext } from "../audit-log/context";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
  workspaceTable,
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
  if (!role || isGuestRole(role)) return false;
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
   * the workspace role counts (open project, owner, admin). A guest's always
   * counts.
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
  const openToRole = visibility === "open" && !isGuestRole(row.workspaceRole);
  if (
    openToRole ||
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
 * Whether `userId` is a guest of the workspace. Instance admins never are:
 * their reach does not come from the workspace.
 */
export function isWorkspaceGuest(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  return memo(`guest:${userId}:${workspaceId}`, async () => {
    const [row] = await db
      .select({
        workspaceRole: workspaceUserTable.role,
        userRole: userTable.role,
      })
      .from(userTable)
      .leftJoin(
        workspaceUserTable,
        and(
          eq(workspaceUserTable.userId, userTable.id),
          eq(workspaceUserTable.workspaceId, workspaceId),
        ),
      )
      .where(eq(userTable.id, userId))
      .limit(1);
    return (
      Boolean(row) &&
      isGuestRole(row?.workspaceRole) &&
      !instanceReach(row?.userRole)
    );
  });
}

/**
 * The projects of a workspace that `userId` may not see: the restricted ones
 * they are no member of, and for a guest every project they are no member
 * of. Empty for owners, admins and instance admins, and in workspaces without
 * a restricted project unless the user is a guest. Includes trashed projects.
 */
export function hiddenProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  return memo(
    `hidden:${userId}:${workspaceId}`,
    async () =>
      (await workspaceZoneAndHiddenProjects(db, userId, workspaceId)).hidden,
  );
}

type Reader = Pick<typeof db, "select">;

/** Raw SQL: a stored role column holds the guest role (isGuestRole). */
function guestRoleSql(role: SQLWrapper): SQL<boolean> {
  return sql<boolean>`string_to_array(replace(${role}, ' ', ''), ',') && ARRAY['guest']::text[]`;
}

/**
 * The projects even an unnamed count must not reach for this caller: those a
 * guest was not added to, and those outside a project-limited API key. Anyone
 * else may hear that a hidden task holds theirs up.
 */
export async function uncountedProjectIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const [guestHidden, outsideKey] = await Promise.all([
    isWorkspaceGuest(userId, workspaceId).then((guest) =>
      guest ? hiddenProjectIds(userId, workspaceId) : [],
    ),
    projectsOutsideRequestKey(workspaceId),
  ]);
  return [...new Set([...guestHidden, ...outsideKey])];
}

/**
 * The workspace's stored time zone (null when unset or the workspace is
 * unknown), the projects `hiddenProjectIds` hides from `userId` and whether
 * they hold the guest role, in one statement, for reads that need them all
 * (the task query context).
 */
export async function workspaceZoneAndHiddenProjects(
  reader: Reader,
  userId: string,
  workspaceId: string,
): Promise<{ timezone: string | null; hidden: string[]; guest: boolean }> {
  const notMember = sql`not exists (
    select 1 from ${projectMemberTable}
    where ${projectMemberTable.projectId} = ${projectTable.id}
      and ${projectMemberTable.userId} = ${userId}
  )`;
  const [row] = await reader
    .select({
      timezone: workspaceTable.timezone,
      workspaceRole: workspaceUserTable.role,
      userRole: userTable.role,
      // Two branches so everyone but guests keeps the partial index on
      // restricted projects (only the branch taken runs).
      restricted: sql<
        string[]
      >`case when ${guestRoleSql(workspaceUserTable.role)}
        then coalesce(array(
          select ${projectTable.id} from ${projectTable}
          where ${projectTable.workspaceId} = ${workspaceTable.id}
            and ${notMember}
        ), '{}')
        else coalesce(array(
          select ${projectTable.id} from ${projectTable}
          where ${projectTable.workspaceId} = ${workspaceTable.id}
            and ${projectTable.visibility} = 'restricted'
            and ${notMember}
        ), '{}')
      end`,
    })
    .from(workspaceTable)
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, workspaceTable.id),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .leftJoin(userTable, eq(userTable.id, userId))
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!row) return { timezone: null, hidden: [], guest: false };
  const sees =
    isWorkspaceManagerRole(row.workspaceRole) || instanceReach(row.userRole);
  return {
    timezone: row.timezone,
    hidden: sees ? [] : row.restricted,
    guest: isGuestRole(row.workspaceRole),
  };
}

/**
 * Projects hidden from `userId` across every workspace, for reads that span
 * workspaces (notification fan-out, digests).
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
      visibility: projectTable.visibility,
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
    .where(inArray(projectTable.id, ids));
  return new Set(
    rows
      .filter(
        (row) =>
          (row.visibility === "restricted" || isGuestRole(row.workspaceRole)) &&
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
  const restricted = project.visibility === "restricted";
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
          (!restricted && !isGuestRole(row.workspaceRole)) ||
          Boolean(row.memberId) ||
          isWorkspaceManagerRole(row.workspaceRole) ||
          // Background fan-out has no request: an instance admin counts.
          row.userRole === "admin",
      )
      .map((row) => row.userId),
  );
}

/**
 * The project roles that cap `userId` in the workspace: in every project of a
 * guest's, and in a member's restricted projects (project/visibility rules
 * above). Empty for owners, admins and instance admins. Trashed projects are
 * left out.
 */
export async function cappingProjectRoles(
  userId: string,
  workspaceId: string,
): Promise<{ projectId: string; projectRole: string }[]> {
  const [me] = await db
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
    !me?.workspaceRole ||
    isWorkspaceManagerRole(me.workspaceRole) ||
    instanceReach(me.userRole)
  ) {
    return [];
  }
  const guest = isGuestRole(me.workspaceRole);
  const rows = await db
    .select({
      projectId: projectMemberTable.projectId,
      projectRole: projectMemberTable.role,
      visibility: projectTable.visibility,
    })
    .from(projectMemberTable)
    .innerJoin(projectTable, eq(projectTable.id, projectMemberTable.projectId))
    .where(
      and(
        eq(projectMemberTable.userId, userId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(asc(projectMemberTable.projectId));
  return rows
    .filter((row) => guest || row.visibility === "restricted")
    .map(({ projectId, projectRole }) => ({ projectId, projectRole }));
}

/**
 * The workspace members who may see the project, by name: whom a picker in
 * the project offers (assignees, mentions). Ids, names and avatars only, so
 * a guest learns no more than the project's own tasks already show.
 */
export async function projectPeople(
  projectId: string,
): Promise<{ id: string; name: string; image: string | null }[]> {
  const [project] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      visibility: projectTable.visibility,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return [];
  const restricted = project.visibility === "restricted";
  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
      memberId: projectMemberTable.userId,
      workspaceRole: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .leftJoin(
      projectMemberTable,
      and(
        eq(projectMemberTable.projectId, projectId),
        eq(projectMemberTable.userId, workspaceUserTable.userId),
      ),
    )
    .where(eq(workspaceUserTable.workspaceId, project.workspaceId))
    .orderBy(asc(userTable.name), asc(userTable.id));
  return rows
    .filter(
      (row) =>
        Boolean(row.memberId) ||
        isWorkspaceManagerRole(row.workspaceRole) ||
        (!restricted && !isGuestRole(row.workspaceRole)),
    )
    .map(({ id, name, image }) => ({ id, name, image }));
}

/**
 * Raw SQL: the project `projectId` (a column or value) is visible to
 * `userId`, for queries that cannot take a precomputed hidden list
 * (notifications across workspaces, digests). Open projects pass, except for
 * a guest; a restricted one needs a project_member row or an owner or admin
 * workspace role. A guest always needs the project_member row.
 */
export function projectVisibleSql(
  projectId: SQLWrapper | string,
  userId: SQLWrapper | string,
): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM project AS visibility_project
    WHERE visibility_project.id = ${projectId}
      AND NOT EXISTS (
        SELECT 1 FROM project_member AS visibility_member
        WHERE visibility_member.project_id = visibility_project.id
          AND visibility_member.user_id = ${userId}
      )
      AND (
        EXISTS (
          SELECT 1 FROM workspace_member AS visibility_guest
          WHERE visibility_guest.workspace_id = visibility_project.workspace_id
            AND visibility_guest.user_id = ${userId}
            AND ${guestRoleSql(sql`visibility_guest.role`)}
        )
        OR (
          visibility_project.visibility = 'restricted'
          AND NOT EXISTS (
            SELECT 1 FROM workspace_member AS visibility_manager
            WHERE visibility_manager.workspace_id = visibility_project.workspace_id
              AND visibility_manager.user_id = ${userId}
              AND string_to_array(replace(visibility_manager.role, ' ', ''), ',')
                && ARRAY['owner', 'admin']::text[]
          )
        )
      )
  )`;
}

/**
 * The workspace's projects outside the project-limited API key of the request
 * in flight. Empty without such a key, and so outside a request.
 */
function projectsOutsideRequestKey(workspaceId: string): Promise<string[]> {
  const keyProjects = currentRequestApiKey()?.projectIds;
  if (!keyProjects?.length) return Promise.resolve([]);
  return memo(`outside-key:${workspaceId}`, async () => {
    const rows = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          notInArray(projectTable.id, keyProjects),
        ),
      );
    return rows.map((row) => row.id);
  });
}

/**
 * A where-condition keeping rows whose project is in the request's
 * project-limited API key, or undefined without such a key (and so outside a
 * request). For unnamed counts, which a hidden list lets through: a limited
 * key doesn't even hear that something outside it exists.
 */
export function insideRequestKey(
  column: Parameters<typeof inArray>[0],
): SQL | undefined {
  const keyProjects = currentRequestApiKey()?.projectIds;
  return keyProjects?.length ? inArray(column, keyProjects) : undefined;
}

/**
 * What `userId` may not see in the workspace and, during a request with a
 * project-limited API key, everything outside the key. For code that names
 * tasks and runs both in requests and in background jobs, where it still hides
 * what `userId` may not see.
 */
export async function hiddenFromUserAndKey(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const [hidden, outsideKey] = await Promise.all([
    hiddenProjectIds(userId, workspaceId),
    projectsOutsideRequestKey(workspaceId),
  ]);
  return outsideKey.length > 0
    ? [...new Set([...hidden, ...outsideKey])]
    : hidden;
}

/**
 * `hiddenFromUserAndKey` for the user of the request in flight, read from the
 * request store, for controllers called without the Hono context. Empty
 * outside a request (internal jobs), so a job acting for someone needs
 * `hiddenFromUserAndKey`.
 */
export async function hiddenForCurrentRequest(
  workspaceId: string,
): Promise<string[]> {
  const userId = auditContext.getStore()?.c?.get("userId") as
    | string
    | undefined;
  return userId ? hiddenFromUserAndKey(userId, workspaceId) : [];
}
