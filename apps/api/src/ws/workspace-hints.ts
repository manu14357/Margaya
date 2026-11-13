import type { FavoriteEntityType } from "../entity-reference/types";
import { publishEvent, subscribeToEvent } from "../events";
import {
  coMemberIds,
  entityReferenceHolders,
  workspaceMemberIds,
} from "./audience";
import { broadcastToUser } from "./index";

// Workspace-wide and per-person hints on the user socket. They reach tabs
// that have no project socket open (Home, Inbox, settings, another project,
// the desktop app's windows) and every device. Like every hint they carry a
// type and ids only, and their audience comes from ws/audience.ts, so nobody
// outside the workspace hears of it. broadcastToUser fans out across API
// instances through the Redis adapter when it is configured.

type Hint = { type: string; [key: string]: unknown };

/** Sends the hint to every member of the workspace. */
export async function broadcastToWorkspace(workspaceId: string, hint: Hint) {
  for (const userId of await workspaceMemberIds(workspaceId)) {
    broadcastToUser(userId, hint);
  }
}

// --- People -----------------------------------------------------------------

/**
 * A person's name, avatar, email, locale or time zone changed (or an agent
 * was renamed). Published from the Better Auth user update hook, the time
 * zone route and agent edits.
 */
export async function publishProfileChanged(userId: string) {
  await publishEvent("user.profile_changed", { userId });
}

// Everyone who sees the person's name on tasks, comments and member lists
// refetches; the person's own tabs and devices also reload their session.
subscribeToEvent<{ userId?: string }>(
  "user.profile_changed",
  async ({ userId }) => {
    if (!userId) return;
    for (const recipient of await coMemberIds(userId)) {
      broadcastToUser(recipient, { type: "USER_PROFILE_UPDATED", userId });
    }
  },
);

// --- Workspace --------------------------------------------------------------

// Name, logo, slug and settings (time zone, public pages...).
for (const eventName of ["workspace.updated", "workspace.settings_updated"]) {
  subscribeToEvent<{ workspaceId?: string }>(
    eventName,
    async ({ workspaceId }) => {
      if (!workspaceId) return;
      await broadcastToWorkspace(workspaceId, {
        type: "WORKSPACE_UPDATED",
        workspaceId,
      });
    },
  );
}

// The project list (sidebar, switchers, favorites, recents, archive and trash)
// changed. The hint names no project, so a restricted project's existence is
// not revealed; each member's refetch returns only what they may see. Members
// with the project open also get PROJECT_UPDATED on its socket.
for (const eventName of [
  "project.created",
  "project.updated",
  "project.features_updated",
  "project.archived",
  "project.unarchived",
  "project.deleted",
  "project.restored",
  "project.purged",
  "project.reordered",
]) {
  subscribeToEvent<{ workspaceId?: string }>(
    eventName,
    async ({ workspaceId }) => {
      if (!workspaceId) return;
      await broadcastToWorkspace(workspaceId, {
        type: "PROJECTS_UPDATED",
        workspaceId,
      });
    },
  );
}

// Labels are workspace-wide: a rename or recolour rewrites every task's copy
// in every project.
subscribeToEvent<{ workspaceId?: string }>(
  "label.changed",
  async ({ workspaceId }) => {
    if (!workspaceId) return;
    await broadcastToWorkspace(workspaceId, {
      type: "LABELS_UPDATED",
      workspaceId,
    });
  },
);

// Workspace views (no project, so no project socket). A private view only
// concerns its owner, unless it just switched access, when everyone's lists
// change.
for (const eventName of ["view.created", "view.updated", "view.deleted"]) {
  subscribeToEvent<{
    workspaceId?: string;
    projectId?: string | null;
    userId?: string;
    access?: string;
    changes?: string[];
  }>(eventName, async ({ workspaceId, projectId, userId, access, changes }) => {
    if (!workspaceId || projectId) return;
    const hint = { type: "VIEWS_UPDATED", workspaceId };
    if (access === "private" && !changes?.includes("access")) {
      if (userId) broadcastToUser(userId, hint);
      return;
    }
    await broadcastToWorkspace(workspaceId, hint);
  });
}

// --- Favorites and recent visits ---------------------------------------------

// They show names, icons and archive state. Their holders refresh when the
// entity changes, whether or not they have its project open.
async function hintHolders(
  entityType: FavoriteEntityType,
  entityIds: readonly (string | null | undefined)[],
) {
  const ids = entityIds.filter((id): id is string => Boolean(id));
  for (const { userId, workspaceId } of await entityReferenceHolders(
    entityType,
    ids,
  )) {
    broadcastToUser(userId, { type: "REFERENCES_UPDATED", workspaceId });
  }
}

const REFERENCE_EVENTS: [string, FavoriteEntityType, string][] = [
  ["cycle.updated", "cycle", "cycleId"],
  ["cycle.archived", "cycle", "cycleId"],
  ["cycle.unarchived", "cycle", "cycleId"],
  ["module.updated", "module", "moduleId"],
  ["module.unarchived", "module", "moduleId"],
  ["view.updated", "view", "viewId"],
  ["page.updated", "page", "pageId"],
  ["page.archived", "page", "pageId"],
  ["page.unarchived", "page", "pageId"],
  ["page.access_changed", "page", "pageId"],
  ["page.moved", "page", "pageId"],
  ["page.deleted", "page", "pageId"],
  ["page.restored", "page", "pageId"],
];

for (const [eventName, entityType, idField] of REFERENCE_EVENTS) {
  subscribeToEvent<Record<string, unknown>>(eventName, async (data) => {
    const id = data[idField];
    const affected = Array.isArray(data.affectedPageIds)
      ? (data.affectedPageIds as string[])
      : [];
    await hintHolders(entityType, [
      typeof id === "string" ? id : null,
      ...affected,
    ]);
  });
}

// Deleted entities take their favorites and recents along
// (entity-reference/registry.ts); the rows' owners refresh.
subscribeToEvent<{ holders?: { userId?: string; workspaceId?: string }[] }>(
  "entity_reference.removed",
  async ({ holders }) => {
    const sent = new Set<string>();
    for (const { userId, workspaceId } of holders ?? []) {
      if (!userId || !workspaceId) continue;
      const key = `${userId}:${workspaceId}`;
      if (sent.has(key)) continue;
      sent.add(key);
      broadcastToUser(userId, { type: "REFERENCES_UPDATED", workspaceId });
    }
  },
);

// --- Inbox counts -------------------------------------------------------------

// Losing access hides notifications about that project, so the person's
// counts (web and the desktop badge) refresh.
subscribeToEvent<{
  workspaceId?: string;
  action?: string;
  memberUserId?: string;
}>("project.access_changed", async ({ workspaceId, action, memberUserId }) => {
  if (!workspaceId) return;
  const hint = { type: "NOTIFICATIONS_UPDATED", workspaceId };
  if (action === "visibility") {
    await broadcastToWorkspace(workspaceId, hint);
  } else if (memberUserId) {
    broadcastToUser(memberUserId, hint);
  }
});

subscribeToEvent<{
  workspaceId?: string;
  userId?: string | null;
  accessEnded?: boolean;
}>(
  "workspace.members_changed",
  async ({ workspaceId, userId, accessEnded }) => {
    if (!workspaceId || !userId || !accessEnded) return;
    broadcastToUser(userId, { type: "NOTIFICATIONS_UPDATED", workspaceId });
  },
);
