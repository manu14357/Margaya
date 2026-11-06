import { randomUUID } from "node:crypto";
import { isGuestRole } from "@margaya/permissions";
import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import db from "../database";
import { workspaceUserTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import type { NotificationCreatedEvent } from "../notification/created-event";
import { mayStayConnected } from "../project/visibility";
import { isRedisConfigured } from "../redis";
import type {
  BroadcastAdapter,
  BroadcastMessage,
  DocBroadcast,
  ProjectBroadcastMessage,
  UserBroadcast,
  UserBroadcastMessage,
} from "./broadcast-adapter";
import { HintThrottle } from "./hint-throttle";
import { InMemoryBroadcastAdapter } from "./in-memory-broadcast-adapter";
import { originWindowId } from "./origin-window";
import { RedisBroadcastAdapter } from "./redis-broadcast-adapter";

const INSTANCE_ID = randomUUID();

type ProjectConnection = {
  ws: WSContext;
  userId: string;
  initiatorId: string;
};

type UserConnection = {
  ws: WSContext;
};

/**
 * User-scoped connections: tracks WebSocket connections keyed by userId.
 * Used for delivering user-targeted events like NOTIFICATION_CREATED.
 */
const userConnections = new Map<string, Set<UserConnection>>();

export function addUserConnection(userId: string, ws: WSContext) {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  const conn: UserConnection = { ws };
  userConnections.get(userId)?.add(conn);
  return conn;
}

export function removeUserConnection(userId: string, conn: UserConnection) {
  const connections = userConnections.get(userId);
  if (connections) {
    connections.delete(conn);
    if (connections.size === 0) {
      userConnections.delete(userId);
    }
  }
}

export function broadcastToUser(userId: string, message: UserBroadcastMessage) {
  deliverToLocalUserConnections(userId, message);

  if (!adapter) {
    return;
  }

  void adapter
    .publishToUser({ userId, message, origin: INSTANCE_ID })
    .catch((err) => {
      console.error("Failed to publish a user broadcast:", err);
    });
}

function deliverToLocalUserConnections(
  userId: string,
  message: UserBroadcastMessage,
) {
  const connections = userConnections.get(userId);
  if (!connections) return;

  const payload = JSON.stringify(message);
  for (const conn of connections) {
    try {
      conn.ws.send(payload);
    } catch {
      connections.delete(conn);
    }
  }
  if (connections.size === 0) {
    userConnections.delete(userId);
  }
}

/**
 * Local connections: each instance tracks only its own WebSocket connections.
 */
const projectConnections = new Map<string, Set<ProjectConnection>>();

/**
 * Batching queues and timers local per-instance.
 * They accumulate messages before flushing to the broadcast adapter.
 */
const projectBroadcastQueues = new Map<
  string,
  Map<string, { message: ProjectBroadcastMessage; excludeInitiatorId?: string }>
>();
const projectBroadcastTimeouts = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

let adapter: BroadcastAdapter | null = null;

// --- Subscribe to incoming broadcasts and deliver to local connections ---
export async function initializeWebSocketAdapter() {
  if (adapter) return;

  const nextAdapter = isRedisConfigured()
    ? new RedisBroadcastAdapter()
    : new InMemoryBroadcastAdapter();

  try {
    await nextAdapter.subscribe((msg: BroadcastMessage) => {
      deliverToLocalConnections(
        msg.projectId,
        msg.message,
        msg.excludeInitiatorId,
      );
    });
    await nextAdapter.subscribeToUser((msg: UserBroadcast) => {
      if (msg.origin === INSTANCE_ID) {
        return;
      }
      deliverToLocalUserConnections(msg.userId, msg.message);
    });
    // Rooms loaded before the adapter existed.
    for (const pageId of docHandlers.keys()) {
      await nextAdapter.subscribeToDoc(pageId, receiveDocBroadcast);
    }
  } catch (err) {
    await nextAdapter.shutdown().catch(() => {});
    throw err;
  }

  adapter = nextAdapter;
  console.log(`📡 WebSockets Initialized using: "${adapter.constructor.name}"`);
}

export async function shutdownWebSocketAdapter() {
  const pendingQueues = [...projectBroadcastQueues.entries()];

  for (const timeout of projectBroadcastTimeouts.values()) {
    clearTimeout(timeout);
  }
  projectBroadcastTimeouts.clear();
  projectBroadcastQueues.clear();
  pageContentHints.clear();

  const currentAdapter = adapter;
  if (currentAdapter) {
    await Promise.allSettled(
      pendingQueues.flatMap(([projectId, queue]) =>
        [...queue.values()].map(({ message, excludeInitiatorId }) =>
          currentAdapter.publish({ projectId, message, excludeInitiatorId }),
        ),
      ),
    );
  }

  await currentAdapter?.shutdown();
  adapter = null;
}

// --- Document channel (page collaboration rooms across instances) ---

type DocHandler = (message: DocBroadcast) => void;
const docHandlers = new Map<string, DocHandler>();

/** Drops this instance's own messages and replies meant for another one. */
function receiveDocBroadcast(message: DocBroadcast) {
  if (message.origin === INSTANCE_ID) return;
  if (message.target && message.target !== INSTANCE_ID) return;
  docHandlers.get(message.pageId)?.(message);
}

/** Receives the page's document messages from other instances. */
export async function subscribeToDocBroadcasts(
  pageId: string,
  handler: DocHandler,
) {
  docHandlers.set(pageId, handler);
  await adapter?.subscribeToDoc(pageId, receiveDocBroadcast);
}

export async function unsubscribeFromDocBroadcasts(pageId: string) {
  if (!docHandlers.delete(pageId)) return;
  await adapter?.unsubscribeFromDoc(pageId);
}

/** Sends a document message to the other instances hosting the page. */
export function publishDocBroadcast(message: Omit<DocBroadcast, "origin">) {
  if (!adapter) return;
  void adapter.publishDoc({ ...message, origin: INSTANCE_ID }).catch((err) => {
    console.error(
      `Failed to publish a document message for page ${message.pageId}:`,
      err,
    );
  });
}

/**
 * Access to a restricted project changed (a member removed, the project
 * restricted). Each instance re-checks its own connections to the project
 * and closes those that lost access, so they stop receiving its events; the
 * rest get the hint. It reaches other instances as a project broadcast, so
 * the in-memory and Redis adapters both carry it.
 */
export const PROJECT_ACCESS_CHANGED = "PROJECT_ACCESS_CHANGED";
/** Close code for a project socket whose access was revoked. */
export const PROJECT_ACCESS_REVOKED_CLOSE_CODE = 4404;

async function recheckProjectConnections(
  projectId: string,
  message: ProjectBroadcastMessage,
) {
  const connections = projectConnections.get(projectId);
  if (!connections) return;
  const verdicts = new Map<string, Promise<boolean>>();
  for (const conn of [...connections]) {
    let verdict = verdicts.get(conn.userId);
    if (!verdict) {
      // Fails closed: a socket that cannot be re-checked is dropped and the
      // client reconnects through the normal access check.
      verdict = mayStayConnected(conn.userId, projectId).catch(() => false);
      verdicts.set(conn.userId, verdict);
    }
    if (await verdict) continue;
    connections.delete(conn);
    try {
      conn.ws.close(
        PROJECT_ACCESS_REVOKED_CLOSE_CODE,
        "Project access revoked",
      );
    } catch {
      // Already closed.
    }
  }
  if (connections.size === 0) {
    projectConnections.delete(projectId);
  }
  deliverToLocalConnections(projectId, message, undefined, true);
}

function deliverToLocalConnections(
  projectId: string,
  message: ProjectBroadcastMessage,
  excludeInitiatorId?: string,
  rechecked = false,
) {
  if (message.type === PROJECT_ACCESS_CHANGED && !rechecked) {
    void recheckProjectConnections(projectId, message);
    return;
  }
  const connections = projectConnections.get(projectId);
  if (!connections) return;

  const payload = JSON.stringify(message);
  for (const conn of connections) {
    if (excludeInitiatorId && conn.initiatorId === excludeInitiatorId) continue;
    try {
      conn.ws.send(payload);
    } catch {
      connections.delete(conn);
    }
  }
  if (connections.size === 0) {
    projectConnections.delete(projectId);
  }
}

export function addConnection(
  projectId: string,
  ws: WSContext,
  userId: string,
  initiatorId: string,
) {
  if (!projectConnections.has(projectId)) {
    projectConnections.set(projectId, new Set());
  }
  const conn: ProjectConnection = { ws, userId, initiatorId };
  projectConnections.get(projectId)?.add(conn);
  return conn;
}

export function removeConnection(projectId: string, conn: ProjectConnection) {
  const connections = projectConnections.get(projectId);
  if (connections) {
    connections.delete(conn);
    if (connections.size === 0) {
      projectConnections.delete(projectId);
    }
  }
}

export function broadcastToProject(
  projectId: string,
  message: ProjectBroadcastMessage,
  excludeInitiatorId?: string,
) {
  if (!adapter) {
    console.warn("broadcastToProject called before adapter initialization");
    return;
  }

  if (!projectBroadcastQueues.has(projectId)) {
    projectBroadcastQueues.set(projectId, new Map());
  }

  const messageKey = `${message.type}:${message.taskId ?? ""}:${message.sourceTaskId ?? ""}:${message.targetTaskId ?? ""}:${message.pageId ?? ""}`;
  projectBroadcastQueues
    .get(projectId)
    ?.set(messageKey, { message, excludeInitiatorId });

  if (projectBroadcastTimeouts.has(projectId)) {
    return;
  }

  const timeout = setTimeout(() => {
    projectBroadcastTimeouts.delete(projectId);
    const queue = projectBroadcastQueues.get(projectId);
    projectBroadcastQueues.delete(projectId);

    if (!queue || !adapter) return;

    // Publish each queued message through the adapter
    for (const { message: msg, excludeInitiatorId: exId } of queue.values()) {
      void adapter
        .publish({
          projectId,
          message: msg,
          excludeInitiatorId: exId,
        })
        .catch((err) => {
          console.error(
            `Failed to publish broadcast for project ${projectId}:`,
            err,
          );
        });
    }
  }, 100);

  projectBroadcastTimeouts.set(projectId, timeout);
}

type TaskEvent = {
  id: string | undefined;
  projectId: string;
  userId: string;
  initiatorId?: string;
  taskId: string;
  sourceTaskId: string | undefined;
  targetTaskId: string | undefined;
  /** Relation events: the other task's project, when it may differ. */
  targetProjectId?: string | null;
};

const taskUpdateEvents = [
  "task.created",
  "task.updated",
  "task.deleted",
  "task.restored",
  "task.purged",
  "task.status_changed",
  "task.archived",
  "task.unarchived",
  "task.priority_changed",
  "task.unassigned",
  "task.assignee_changed",
  "task.due_date_changed",
  "task.start_date_changed",
  "task.title_changed",
  "task.description_changed",
  "task.cycle_changed",
  "task.estimate_changed",
  "task.custom_field_changed",
  "task.recurrence_changed",
  "task.label_assigned",
  "task.label_unassigned",
  "task.label_created",
  "task.label_deleted",
  "task-relation.created",
  "task-relation.deleted",
  "task.link_created",
  "task.link_updated",
  "task.link_deleted",
  "task.attachment_added",
  "task.attachment_removed",
  "task.coding_handoff_updated",
  "comment.created",
  "comment.deleted",
  "comment.updated",
];

subscribeToEvent<{
  taskId: string;
  userId: string;
  initiatorId?: string;
  type: string;
  content: string;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
}>("task.moved", async (data) => {
  const { fromProjectId, initiatorId, toProjectId, taskId } = data;

  broadcastToProject(
    toProjectId,
    { type: "TASK_MOVED", projectId: toProjectId, taskId },
    initiatorId,
  );
  broadcastToProject(
    fromProjectId,
    { type: "TASK_MOVED", projectId: fromProjectId, taskId },
    initiatorId,
  );
});

subscribeToEvent<{
  projectId: string;
  userId: string;
  initiatorId?: string;
}>("task-relation.refresh", async (data) => {
  const { projectId, initiatorId } = data;
  if (!projectId) return;

  broadcastToProject(
    projectId,
    {
      type: "TASK_RELATION_UPDATED",
      projectId,
      taskId: "",
      sourceTaskId: undefined,
      targetTaskId: undefined,
    },
    initiatorId,
  );
});

// Column and project-setting events carry no taskId, so the generic task loop
// below skips them. Messages are refetch hints only, never entity data.
for (const eventName of [
  "column.created",
  "column.updated",
  "column.reordered",
  "column.deleted",
]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "COLUMNS_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

// Cycle list, detail and progress hints. Membership changes also publish
// task.cycle_changed per task, which reaches clients as TASK_UPDATED.
for (const eventName of [
  "cycle.created",
  "cycle.updated",
  "cycle.archived",
  "cycle.unarchived",
  "cycle.deleted",
  "cycle.tasks_changed",
]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "CYCLE_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

// Module list, detail, progress and task-map hints. The board payload holds
// no module data, so membership changes send no TASK_UPDATED.
for (const eventName of [
  "module.created",
  "module.updated",
  "module.deleted",
  "module.archived",
  "module.unarchived",
  "module.reordered",
  "module.links_changed",
  "module.tasks_changed",
]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "MODULE_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

// Estimate system hints. A remap of many tasks sends one project-level
// ESTIMATE_TASKS_REMAPPED instead of one TASK_UPDATED per task.
for (const [eventName, type] of [
  ["estimate.created", "ESTIMATE_UPDATED"],
  ["estimate.updated", "ESTIMATE_UPDATED"],
  ["estimate.deleted", "ESTIMATE_UPDATED"],
  ["estimate.activated", "ESTIMATE_UPDATED"],
  ["estimate.tasks_remapped", "ESTIMATE_TASKS_REMAPPED"],
] as const) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type, projectId, taskId: "" },
        initiatorId,
      );
    },
  );
}

// Project view list and detail hints. Workspace views have no channel: their
// pages refetch on focus. Hints carry no view data, so private names never
// travel over the socket.
for (const eventName of ["view.created", "view.updated", "view.deleted"]) {
  subscribeToEvent<{ projectId?: string | null; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "VIEWS_UPDATED", projectId, taskId: "" },
        initiatorId,
      );
    },
  );
}

// A field was added, edited or removed: its lists, values and the task lists
// that group or sort by it refresh (renaming an option rewrites task values).
for (const eventName of [
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "CUSTOM_FIELDS_UPDATED", projectId, taskId: "" },
        initiatorId,
      );
    },
  );
}

// One hint for a bulk edit, instead of one message per task.
subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
  "custom_field.values_changed",
  async ({ projectId, initiatorId }) => {
    if (!projectId) return;
    broadcastToProject(
      projectId,
      { type: "TASKS_CHANGED", projectId },
      initiatorId,
    );
  },
);

for (const eventName of ["project.features_updated", "project.updated"]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "PROJECT_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

// Page hints (B5). They carry ids only, so private titles never travel over
// the project socket. Content lives on the page socket, not here.
type PageHintEvent = {
  pageId?: string;
  projectId?: string | null;
  initiatorId?: string;
};

function sendPageUpdated({ pageId, projectId, initiatorId }: PageHintEvent) {
  if (!pageId || !projectId) return;
  broadcastToProject(
    projectId,
    { type: "PAGE_UPDATED", projectId, pageId },
    initiatorId,
  );
}

for (const eventName of [
  "page.created",
  "page.updated",
  "page.locked",
  "page.unlocked",
  "page.version_restored",
  "page.comment_created",
  "page.comment_updated",
  "page.comment_deleted",
]) {
  subscribeToEvent<PageHintEvent>(eventName, async (data) =>
    sendPageUpdated(data),
  );
}

// Content saves arrive every few seconds while people type: at most one
// hint per page per minute (a leading send and one trailing send).
const pageContentHints = new HintThrottle<PageHintEvent>(
  60_000,
  sendPageUpdated,
);
subscribeToEvent<PageHintEvent>("page.content_updated", async (data) => {
  if (data.pageId) pageContentHints.push(data.pageId, data);
});

for (const eventName of [
  "page.reordered",
  "page.archived",
  "page.unarchived",
  "page.access_changed",
  "page.restored",
  "page.purged",
]) {
  subscribeToEvent<PageHintEvent>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "PAGES_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

subscribeToEvent<{
  fromProjectId?: string;
  toProjectId?: string;
  initiatorId?: string;
}>("page.moved", async ({ fromProjectId, toProjectId, initiatorId }) => {
  for (const projectId of [fromProjectId, toProjectId]) {
    if (!projectId) continue;
    broadcastToProject(
      projectId,
      { type: "PAGES_UPDATED", projectId },
      initiatorId,
    );
  }
});

subscribeToEvent<PageHintEvent>(
  "page.deleted",
  async ({ pageId, projectId, initiatorId }) => {
    if (!pageId || !projectId) return;
    broadcastToProject(
      projectId,
      { type: "PAGE_DELETED", projectId, pageId },
      initiatorId,
    );
  },
);

// Scheduled automation settings, task templates, the project's archive
// state (B11) and its trash state (C7).
for (const eventName of [
  "project.automations_updated",
  "project.task_templates_updated",
  "project.archived",
  "project.unarchived",
  "project.deleted",
  "project.restored",
]) {
  subscribeToEvent<{ projectId?: string; initiatorId?: string }>(
    eventName,
    async ({ projectId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "PROJECT_UPDATED", projectId },
        initiatorId,
      );
    },
  );
}

// Project access changed (PLAN 5.1): sockets that lost access are closed
// (see recheckProjectConnections). The affected people get a user-channel
// hint so their project lists, favourites and views refresh: the member for
// a membership change, every workspace member for a visibility switch.
subscribeToEvent<{
  projectId?: string;
  workspaceId?: string;
  action?: string;
  memberUserId?: string;
}>("project.access_changed", async (data) => {
  const { projectId, workspaceId, action, memberUserId } = data;
  if (!projectId || !workspaceId) return;
  broadcastToProject(projectId, { type: PROJECT_ACCESS_CHANGED, projectId });
  const hint = { type: PROJECT_ACCESS_CHANGED, workspaceId, projectId };
  if (action !== "visibility") {
    if (memberUserId) broadcastToUser(memberUserId, hint);
    return;
  }
  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  for (const { userId, role } of members) {
    // A guest's projects don't depend on this switch, and the hint names a
    // project they may not know about.
    if (!isGuestRole(role)) broadcastToUser(userId, hint);
  }
});

// One hint per project and rule when the automation job archives or closes
// many tasks at once, instead of one message per task. No initiator.
subscribeToEvent<{ projectId?: string }>(
  "task.automation_applied",
  async ({ projectId }) => {
    if (!projectId) return;
    broadcastToProject(projectId, { type: "TASKS_CHANGED", projectId });
  },
);

// Drafts are private: the hint, with no content, goes to the owner only.
subscribeToEvent<{ userId?: string; workspaceId?: string }>(
  "task_draft.changed",
  async ({ userId, workspaceId }) => {
    if (userId && workspaceId) {
      broadcastToUser(userId, { type: "DRAFTS_UPDATED", workspaceId });
    }
  },
);

// The user channel does not exclude the initiator; a refetch there is
// harmless and keeps the user's other tabs current.
subscribeToEvent<{ userId?: string; workspaceId?: string }>(
  "favorite.changed",
  async ({ userId, workspaceId }) => {
    if (userId && workspaceId) {
      broadcastToUser(userId, { type: "FAVORITES_UPDATED", workspaceId });
    }
  },
);

// Personal Home data: hints with no content. originWindowId names the tab
// that made the change, so it can skip its own echo while typing.
for (const [eventName, type] of [
  ["sticky.changed", "STICKIES_UPDATED"],
  ["quick_link.changed", "QUICK_LINKS_UPDATED"],
  ["home_preferences.changed", "HOME_PREFERENCES_UPDATED"],
] as const) {
  subscribeToEvent<{
    userId?: string;
    workspaceId?: string;
    initiatorId?: string;
  }>(eventName, async ({ userId, workspaceId, initiatorId }) => {
    if (!userId || !workspaceId) return;
    broadcastToUser(userId, {
      type,
      workspaceId,
      originWindowId: originWindowId(userId, initiatorId),
    });
  });
}

// The type and flags (no content) let the recipient's tabs choose a sound.
subscribeToEvent<NotificationCreatedEvent>(
  "notification.created",
  async (data) => {
    if (data.userId) {
      broadcastToUser(data.userId, {
        type: "NOTIFICATION_CREATED",
        notificationType: data.notificationType ?? null,
        reply: data.reply === true,
        needsInput: data.needsInput === true,
      });
    }
  },
);

// Inbox state changed (read, archive, snooze, bulk, resurfacing, cleanup):
// a refetch hint for the user's other tabs.
subscribeToEvent<{ userId?: string; workspaceId?: string | null }>(
  "notification.updated",
  async ({ userId, workspaceId }) => {
    if (userId) {
      broadcastToUser(userId, {
        type: "NOTIFICATIONS_UPDATED",
        workspaceId: workspaceId ?? null,
      });
    }
  },
);

subscribeToEvent<{ userId?: string; taskId?: string }>(
  "task.subscription_changed",
  async ({ userId, taskId }) => {
    if (userId && taskId) {
      broadcastToUser(userId, { type: "SUBSCRIPTION_UPDATED", taskId });
    }
  },
);

// Reaction hints carry no names or emoji; clients refetch the task's
// reactions.
for (const eventName of ["reaction.added", "reaction.removed"]) {
  subscribeToEvent<{
    projectId?: string;
    taskId?: string;
    initiatorId?: string;
  }>(eventName, async ({ projectId, taskId, initiatorId }) => {
    if (!projectId || !taskId) return;
    broadcastToProject(
      projectId,
      { type: "REACTIONS_UPDATED", projectId, taskId },
      initiatorId,
    );
  });
}

for (const eventName of taskUpdateEvents) {
  subscribeToEvent<TaskEvent>(eventName, async (data) => {
    const { projectId, initiatorId } = data;
    const taskId = data.taskId;

    if (!projectId || !taskId) return;
    let type: string;
    switch (eventName) {
      case "task.created":
        type = "TASK_CREATED";
        break;
      case "task.deleted":
        type = "TASK_DELETED";
        break;
      // Trash (C7): a restored task reappears; a purge only changes the
      // project's trash list.
      case "task.restored":
        type = "TASK_RESTORED";
        break;
      case "task.purged":
        type = "TASK_PURGED";
        break;
      case "task-relation.created":
      case "task-relation.deleted":
        type = "TASK_RELATION_UPDATED";
        break;
      // Links and attachments are not in the board payload, so these never
      // ask for a board refetch.
      case "task.link_created":
      case "task.link_updated":
      case "task.link_deleted":
        type = "TASK_LINKS_UPDATED";
        break;
      case "task.attachment_added":
      case "task.attachment_removed":
        type = "TASK_ATTACHMENTS_UPDATED";
        break;
      // A coding-agent handoff moved (issue sent, pull request opened,
      // ready, merged or closed): only the task panel refetches.
      case "task.coding_handoff_updated":
        type = "CODING_HANDOFF_UPDATED";
        break;
      case "task.label_assigned":
      case "task.label_unassigned":
      case "task.label_created":
      case "task.label_deleted":
        type = "TASK_LABEL_UPDATED";
        break;
      case "comment.created":
      case "comment.deleted":
      case "comment.updated":
        type = "COMMENT_UPDATED";
        break;
      default:
        type = "TASK_UPDATED";
    }

    if (eventName === "task.label_deleted") {
      // Cascade deletion waits for this adapter operation rather than growing
      // the ordinary 100ms broadcast queue behind a slow Redis connection.
      await adapter?.publish({
        projectId,
        message: { type, projectId, taskId },
        excludeInitiatorId: initiatorId,
      });
      return;
    }

    // A project's sockets can include people who can't see another project, so
    // a relation names both tasks only when both are known to be in this one.
    const { targetProjectId, targetTaskId } = data;
    const isRelation = type === "TASK_RELATION_UPDATED";
    const nameable = (id: string | undefined) =>
      !isRelation || targetProjectId === projectId || id === taskId
        ? id
        : undefined;
    broadcastToProject(
      projectId,
      {
        type,
        projectId,
        taskId: taskId,
        sourceTaskId: nameable(data.sourceTaskId),
        targetTaskId: nameable(targetTaskId),
      },
      initiatorId,
    );

    // A relation across projects also refreshes the other task's project.
    if (
      isRelation &&
      targetProjectId &&
      targetTaskId &&
      targetProjectId !== projectId
    ) {
      broadcastToProject(
        targetProjectId,
        {
          type,
          projectId: targetProjectId,
          taskId: targetTaskId,
          targetTaskId,
        },
        initiatorId,
      );
    }
  });
}

type ParentRef = { id?: string; projectId?: string | null } | null;

// A parent change refreshes the child's relations (and so both parents'
// sub-task lists) in the child's project, and in a legacy old parent's
// project when that differs. Each project's message names only its own tasks.
subscribeToEvent<{
  taskId?: string;
  projectId?: string;
  initiatorId?: string;
  oldParent?: ParentRef;
  newParent?: ParentRef;
}>("task.parent_changed", async (data) => {
  const { taskId, projectId, initiatorId, oldParent, newParent } = data;
  if (!taskId || !projectId) return;
  const parentHere = (parent: ParentRef | undefined) =>
    parent?.projectId === projectId ? parent.id : undefined;
  broadcastToProject(
    projectId,
    {
      type: "TASK_RELATION_UPDATED",
      projectId,
      taskId,
      sourceTaskId: parentHere(newParent) ?? parentHere(oldParent),
      targetTaskId: taskId,
    },
    initiatorId,
  );
  if (
    oldParent?.id &&
    oldParent.projectId &&
    oldParent.projectId !== projectId
  ) {
    broadcastToProject(
      oldParent.projectId,
      {
        type: "TASK_RELATION_UPDATED",
        projectId: oldParent.projectId,
        taskId: oldParent.id,
        sourceTaskId: oldParent.id,
      },
      initiatorId,
    );
  }
});
