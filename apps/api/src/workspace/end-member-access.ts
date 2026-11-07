import { and, eq, inArray, or } from "drizzle-orm";
import { PROJECTS_MARKER, removeScopedProjects } from "../api-key/scope";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  apikeyTable,
  projectMemberTable,
  projectTable,
  pushSubscriptionTable,
  sessionTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { recordInstanceAudit } from "../instance-admin/audit";

// Sessions and API keys belong to an account, not to a workspace, and every
// request re-checks membership, so a removed person loses the workspace at
// once whatever is done here. This clears what would otherwise linger:
// - their restricted-project memberships, which a later re-invitation would
//   silently bring back;
// - sessions pointing at the workspace as the active one;
// - project-limited keys: this workspace's projects leave the key's scope, and
//   a key with no project left is deleted (an empty list would mean no limit).
//
// When an admin removed them and this was their last workspace, nothing is left
// for their keys and sessions to reach, so those end too. Otherwise they stay:
// a workspace's admins don't get to sign someone out of another workspace or
// break their keys there. Instance admins keep theirs, since their access
// never came from this workspace, and so does anyone who chose to leave.

function storedScope(raw: string | null): Record<string, string[]> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, string[]>)
      : null;
  } catch {
    return null;
  }
}

export async function endMemberAccess({
  workspaceId,
  userId,
  byThemselves,
}: {
  workspaceId: string;
  userId: string;
  byThemselves: boolean;
}) {
  const { revoked, sessionsEnded, email } = await db.transaction(async (tx) => {
    await tx
      .delete(projectMemberTable)
      .where(
        and(
          eq(projectMemberTable.userId, userId),
          inArray(
            projectMemberTable.projectId,
            tx
              .select({ id: projectTable.id })
              .from(projectTable)
              .where(eq(projectTable.workspaceId, workspaceId)),
          ),
        ),
      );
    await tx
      .update(sessionTable)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(sessionTable.userId, userId),
          eq(sessionTable.activeOrganizationId, workspaceId),
        ),
      );

    const keys = await tx
      .select({
        id: apikeyTable.id,
        name: apikeyTable.name,
        permissions: apikeyTable.permissions,
      })
      .from(apikeyTable)
      .where(
        or(eq(apikeyTable.referenceId, userId), eq(apikeyTable.userId, userId)),
      );

    const limitedTo = keys.flatMap(
      (key) => storedScope(key.permissions)?.[PROJECTS_MARKER] ?? [],
    );
    const projectIds = new Set(
      limitedTo.length === 0
        ? []
        : (
            await tx
              .select({ id: projectTable.id })
              .from(projectTable)
              .where(
                and(
                  eq(projectTable.workspaceId, workspaceId),
                  inArray(projectTable.id, limitedTo),
                ),
              )
          ).map((project) => project.id),
    );
    const toDelete = new Map<string, string | null>();
    for (const key of keys) {
      const stored = storedScope(key.permissions);
      const narrowed = stored && removeScopedProjects(stored, projectIds);
      if (narrowed === "no-projects-left") {
        toDelete.set(key.id, key.name);
      } else if (narrowed) {
        await tx
          .update(apikeyTable)
          .set({ permissions: JSON.stringify(narrowed) })
          .where(eq(apikeyTable.id, key.id));
      }
    }

    const [owner] = await tx
      .select({ role: userTable.role, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    const [otherWorkspace] = await tx
      .select({ id: workspaceUserTable.id })
      .from(workspaceUserTable)
      .where(eq(workspaceUserTable.userId, userId))
      .limit(1);
    const nothingLeft =
      !byThemselves && !otherWorkspace && owner?.role !== "admin";

    let ended = 0;
    if (nothingLeft) {
      for (const key of keys) toDelete.set(key.id, key.name);
      const sessions = await tx
        .delete(sessionTable)
        .where(eq(sessionTable.userId, userId))
        .returning({ id: sessionTable.id });
      ended = sessions.length;
      await tx
        .delete(pushSubscriptionTable)
        .where(eq(pushSubscriptionTable.userId, userId));
    }
    if (toDelete.size > 0) {
      await tx
        .delete(apikeyTable)
        .where(inArray(apikeyTable.id, [...toDelete.keys()]));
    }
    return { revoked: toDelete, sessionsEnded: ended, email: owner?.email };
  });

  await recordAudit(
    [...revoked].map(([id, name]) => ({
      workspaceId,
      action: "api_key.revoked" as const,
      target: { type: "api_key" as const, id, label: name },
      metadata: { reason: "member_removed" },
    })),
  );
  if (sessionsEnded > 0) {
    await recordInstanceAudit({
      action: "user.sessions_revoked",
      target: { type: "user", id: userId, label: email ?? null },
      metadata: { sessions: sessionsEnded, reason: "member_removed" },
    });
  }
}
