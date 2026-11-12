import { and, eq } from "drizzle-orm";
import db from "../database";
import {
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import {
  cappingProjectRoles,
  workspaceZoneAndHiddenProjects,
} from "../project/visibility";
import {
  builtInRoleStatements,
  customRoleStatements,
  projectRoleStatements,
} from "../utils/require-workspace-permission";
import { isValidTimezone, resolveTimezone } from "../utils/zoned-date";

// What a feed's owner may see right now. A feed URL carries no session, so
// every fetch answers the same questions a signed-in read would: still a
// member of the workspace, a role that reads tasks, and which projects are
// hidden (restricted, guest-only or capped by a project role).

type Statements = Record<string, readonly string[]>;

function grants(
  statements: Statements | null,
  resource: string,
  action: string,
) {
  return Boolean(statements?.[resource]?.includes(action));
}

export type FeedAccess = {
  workspaceName: string;
  /** The owner's zone, else the workspace's, else UTC. */
  timezone: string;
  /** Projects whose tasks the owner may not read. */
  hiddenProjectIds: string[];
  /** Whether cycles show at all, and the projects whose cycles may not. */
  canReadCycles: boolean;
  cycleHiddenProjectIds: string[];
};

/** Null when the owner is no longer a member or may not read tasks. */
export async function loadFeedAccess(
  userId: string,
  workspaceId: string,
): Promise<FeedAccess | null> {
  const [member] = await db
    .select({
      role: workspaceUserTable.role,
      userTimezone: userTable.timezone,
      workspaceTimezone: workspaceTable.timezone,
      workspaceName: workspaceTable.name,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member) return null;

  const statements =
    (await customRoleStatements(workspaceId, member.role)) ??
    builtInRoleStatements(member.role);
  if (!grants(statements, "task", "read")) return null;

  const [{ hidden }, capping] = await Promise.all([
    workspaceZoneAndHiddenProjects(db, userId, workspaceId),
    cappingProjectRoles(userId, workspaceId),
  ]);

  const taskCapped: string[] = [];
  const cycleCapped: string[] = [];
  const byRole = new Map<string, Statements>();
  for (const { projectId, projectRole } of capping) {
    let projectStatements = byRole.get(projectRole);
    if (!projectStatements) {
      projectStatements = await projectRoleStatements(workspaceId, projectRole);
      byRole.set(projectRole, projectStatements);
    }
    if (!grants(projectStatements, "task", "read")) taskCapped.push(projectId);
    if (!grants(projectStatements, "cycle", "read")) {
      cycleCapped.push(projectId);
    }
  }

  const hiddenProjectIds = [...new Set([...hidden, ...taskCapped])];
  return {
    workspaceName: member.workspaceName,
    timezone:
      member.userTimezone && isValidTimezone(member.userTimezone)
        ? member.userTimezone
        : resolveTimezone(member.workspaceTimezone),
    hiddenProjectIds,
    canReadCycles: grants(statements, "cycle", "read"),
    cycleHiddenProjectIds: [...new Set([...hiddenProjectIds, ...cycleCapped])],
  };
}
