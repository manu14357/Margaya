import type { WebhookEntityType } from "./types";

// The public webhook contract (B13a §2.5): which internal bus events become
// which public events, how each locates its workspace, who the actor is,
// what `changes` carries and which privacy filter applies. Pure data and
// functions; the enqueue step does the database work.
//
// Public names stay stable when internal names change. Names the per-project
// generic webhook already uses (task.created, task.status_changed, ...) are
// kept so consumers can switch without renaming.

export const WEBHOOK_FAMILIES = [
  "project",
  "column",
  "task",
  "comment",
  "reaction",
  "time_entry",
  "cycle",
  "module",
  "page",
  "view",
  "intake",
  "estimate",
] as const;
export type WebhookFamily = (typeof WEBHOOK_FAMILIES)[number];

export const WEBHOOK_PING_EVENT = "webhook.ping";

export type Payload = Record<string, unknown>;

/** Where an event happened; the enqueue step resolves it in one query. */
export type Locator = {
  workspaceId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
};

/**
 * Filters applied at enqueue time:
 * - `triage`: skipped while the task waits in intake (no fan-out until it
 *   is accepted, the same guard the project integrations use);
 * - `page`: only public pages leave Margaya (D14, P1);
 * - `view`: only shared views leave Margaya (D14, P2);
 * - `time_tracking`: only when the project's time tracking is on (P4).
 */
export type PrivacyRule = "triage" | "page" | "view" | "time_tracking";

export type ProjectRef = { id: string; name: string; slug: string };

export type SourceSpec = {
  /** The entity id the snapshot is loaded for. */
  entityId: (payload: Payload) => string | null;
  locate: (payload: Payload) => Locator;
  /** The acting user id; null for jobs and automation. */
  actor: (payload: Payload) => string | null;
  changes: (payload: Payload) => Record<string, unknown> | null;
  /** Data taken from the payload instead of a snapshot (deletions). */
  payloadData?: (payload: Payload) => Record<string, unknown>;
  /** The project when its row is already gone (project.deleted). */
  projectFromPayload?: (payload: Payload) => ProjectRef | null;
  privacy: PrivacyRule[];
  /** Deliveries that are rewritten while still waiting (K14). */
  coalesceKey?: (payload: Payload) => string | null;
  /** The payload says the change should not be announced at all. */
  skip?: (payload: Payload) => boolean;
};

export type CatalogEvent = {
  name: string;
  family: WebhookFamily;
  entity: WebhookEntityType;
};

// --- payload readers -------------------------------------------------------

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function list(payload: Payload, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function value(payload: Payload, key: string): unknown {
  return payload[key] === undefined ? null : payload[key];
}

/** `{ field: null }` for each name in a changed-fields list. */
function namesOnly(payload: Payload, key: string) {
  const names = list(payload, key);
  return names.length > 0
    ? Object.fromEntries(names.map((name) => [name, null]))
    : null;
}

function oldNew(payload: Payload, oldKey: string, newKey: string) {
  return { old: value(payload, oldKey), new: value(payload, newKey) };
}

const byUser = (payload: Payload) => str(payload, "userId");
const noActor = () => null;
const noChanges = () => null;
const inProject = (payload: Payload): Locator => ({
  projectId: str(payload, "projectId"),
  workspaceId: str(payload, "workspaceId"),
});
const onTask = (payload: Payload): Locator => ({
  projectId: str(payload, "projectId"),
  taskId: str(payload, "taskId"),
});

function source(spec: Partial<SourceSpec> & Pick<SourceSpec, "entityId">) {
  return {
    locate: inProject,
    actor: byUser,
    changes: noChanges,
    privacy: [],
    ...spec,
  } satisfies SourceSpec;
}

// --- per family -------------------------------------------------------------

const projectSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "projectId"), ...spec });

const columnSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "columnId"), ...spec });

const taskSource = (spec: Partial<SourceSpec> = {}) =>
  source({
    entityId: (p) => str(p, "taskId"),
    locate: onTask,
    privacy: ["triage"],
    ...spec,
  });

const cycleSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "cycleId"), ...spec });

const moduleSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "moduleId"), ...spec });

const pageSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "pageId"), privacy: ["page"], ...spec });

const viewSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "viewId"), privacy: ["view"], ...spec });

const intakeSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "intakeItemId"), ...spec });

const estimateSource = (spec: Partial<SourceSpec> = {}) =>
  source({ entityId: (p) => str(p, "estimateId"), ...spec });

const commentSource = (spec: Partial<SourceSpec> = {}) =>
  source({
    entityId: (p) => str(p, "id"),
    locate: onTask,
    privacy: ["triage"],
    skip: (p) => !str(p, "id"),
    ...spec,
  });

const labelChange = (p: Payload) => {
  const label = p.label as { name?: unknown; color?: unknown } | undefined;
  return {
    label: {
      name: typeof label?.name === "string" ? label.name : null,
      color: typeof label?.color === "string" ? label.color : null,
    },
  };
};

const relationChange = (p: Payload) => ({
  relation: {
    type: value(p, "relationType"),
    sourceTaskId: value(p, "sourceTaskId"),
    targetTaskId: value(p, "targetTaskId"),
    sourceKey: value(p, "sourceTaskKey"),
    targetKey: value(p, "targetTaskKey"),
  },
});

const linkChange = (p: Payload) => ({
  link: {
    id: value(p, "linkId"),
    url: value(p, "url"),
    title: value(p, "title"),
    ...("oldUrl" in p || "oldTitle" in p
      ? { old: { url: value(p, "oldUrl"), title: value(p, "oldTitle") } }
      : {}),
  },
});

const attachmentChange = (p: Payload) => ({
  attachment: {
    id: value(p, "attachmentId"),
    filename: value(p, "filename"),
    size: value(p, "size"),
    mimeType: value(p, "mimeType"),
  },
});

function pointOf(p: Payload, prefix: "old" | "new") {
  const pointId = str(p, `${prefix}PointId`);
  return pointId
    ? {
        pointId,
        value: value(p, `${prefix}Value`),
        type: value(p, `${prefix}Type`),
      }
    : null;
}

function cycleOf(p: Payload, prefix: "old" | "new") {
  const id = str(p, `${prefix}CycleId`);
  return id ? { id, name: value(p, `${prefix}CycleName`) } : null;
}

// --- the catalog --------------------------------------------------------------

type EntryInput = {
  entity: WebhookEntityType;
  sources: Record<string, SourceSpec>;
};

const ENTRIES: Record<string, EntryInput> = {
  // Projects
  "project.created": {
    entity: "project",
    sources: { "project.created": projectSource() },
  },
  "project.updated": {
    entity: "project",
    sources: {
      "project.updated": projectSource({
        changes: (p) => namesOnly(p, "changed"),
      }),
      "project.features_updated": projectSource({
        changes: () => ({ features: null }),
      }),
      "project.automations_updated": projectSource({
        changes: () => ({ automations: null }),
      }),
    },
  },
  "project.archived": {
    entity: "project",
    sources: { "project.archived": projectSource() },
  },
  "project.unarchived": {
    entity: "project",
    sources: { "project.unarchived": projectSource() },
  },
  // The project's public board (B12). Never the link token or settings
  // values: the data is the project snapshot.
  "project.published": {
    entity: "project",
    sources: { "publication.published": projectSource() },
  },
  "project.unpublished": {
    entity: "project",
    sources: { "publication.unpublished": projectSource() },
  },
  "project.publication_updated": {
    entity: "project",
    sources: {
      "publication.updated": projectSource({
        changes: (p) => namesOnly(p, "changes"),
      }),
    },
  },
  "project.public_link_rotated": {
    entity: "project",
    sources: { "publication.link_rotated": projectSource() },
  },
  "project.deleted": {
    entity: "project",
    sources: {
      "project.deleted": projectSource({
        locate: (p) => ({ workspaceId: str(p, "workspaceId") }),
        payloadData: (p) => ({
          id: value(p, "projectId"),
          name: value(p, "name"),
          slug: value(p, "slug"),
        }),
        projectFromPayload: (p) => {
          const id = str(p, "projectId");
          return id
            ? { id, name: String(p.name ?? ""), slug: String(p.slug ?? "") }
            : null;
        },
      }),
    },
  },
  // Trash (C7): project.deleted means "moved to the trash"; a restore brings
  // the project back, a purge deletes it for good.
  "project.restored": {
    entity: "project",
    sources: { "project.restored": projectSource() },
  },
  "project.purged": {
    entity: "project",
    sources: {
      "project.purged": projectSource({
        locate: (p) => ({ workspaceId: str(p, "workspaceId") }),
        payloadData: (p) => ({
          id: value(p, "projectId"),
          name: value(p, "name"),
          slug: value(p, "slug"),
        }),
        projectFromPayload: (p) => {
          const id = str(p, "projectId");
          return id
            ? { id, name: String(p.name ?? ""), slug: String(p.slug ?? "") }
            : null;
        },
      }),
    },
  },

  // Statuses
  "column.created": {
    entity: "column",
    sources: { "column.created": columnSource() },
  },
  "column.updated": {
    entity: "column",
    sources: {
      "column.updated": columnSource({
        changes: (p) => namesOnly(p, "changed"),
      }),
    },
  },
  "column.deleted": {
    entity: "column",
    sources: {
      "column.deleted": columnSource({
        payloadData: (p) => ({
          id: value(p, "columnId"),
          projectId: value(p, "projectId"),
        }),
      }),
    },
  },

  // Tasks
  "task.created": {
    entity: "task",
    sources: {
      // The payload's userId is the first assignee; the creator is
      // currentUserId (absent for imports and synced issues).
      "task.created": taskSource({ actor: (p) => str(p, "currentUserId") }),
    },
  },
  "task.updated": {
    entity: "task",
    sources: { "task.updated": taskSource() },
  },
  "task.deleted": {
    entity: "task",
    sources: {
      "task.deleted": taskSource({
        payloadData: (p) => ({
          id: value(p, "taskId"),
          projectId: value(p, "projectId"),
          title: value(p, "title"),
        }),
      }),
    },
  },
  // Trash (C7): task.deleted means "moved to the trash"; a restore brings
  // the task back, a purge deletes it for good.
  "task.restored": {
    entity: "task",
    sources: { "task.restored": taskSource() },
  },
  "task.purged": {
    entity: "task",
    sources: {
      "task.purged": taskSource({
        payloadData: (p) => ({
          id: value(p, "taskId"),
          projectId: value(p, "projectId"),
          title: value(p, "title"),
        }),
      }),
    },
  },
  "task.moved": {
    entity: "task",
    sources: {
      "task.moved": taskSource({
        locate: (p) => ({
          projectId: str(p, "toProjectId"),
          taskId: str(p, "taskId"),
        }),
        changes: (p) => ({
          project: oldNew(p, "fromProjectId", "toProjectId"),
          status: oldNew(p, "oldStatus", "newStatus"),
        }),
      }),
    },
  },
  "task.status_changed": {
    entity: "task",
    sources: {
      "task.status_changed": taskSource({
        changes: (p) => ({ status: oldNew(p, "oldStatus", "newStatus") }),
      }),
    },
  },
  "task.priority_changed": {
    entity: "task",
    sources: {
      "task.priority_changed": taskSource({
        changes: (p) => ({
          priority: oldNew(p, "oldPriority", "newPriority"),
        }),
      }),
    },
  },
  "task.title_changed": {
    entity: "task",
    sources: {
      "task.title_changed": taskSource({
        changes: (p) => ({ title: oldNew(p, "oldTitle", "newTitle") }),
      }),
    },
  },
  "task.description_changed": {
    entity: "task",
    sources: {
      "task.description_changed": taskSource({
        changes: (p) => ({
          description: oldNew(p, "oldDescription", "newDescription"),
        }),
      }),
    },
  },
  "task.due_date_changed": {
    entity: "task",
    sources: {
      "task.due_date_changed": taskSource({
        changes: (p) => ({ dueDate: oldNew(p, "oldDueDate", "newDueDate") }),
      }),
    },
  },
  "task.start_date_changed": {
    entity: "task",
    sources: {
      "task.start_date_changed": taskSource({
        changes: (p) => ({
          startDate: oldNew(p, "oldStartDate", "newStartDate"),
        }),
      }),
    },
  },
  "task.parent_changed": {
    entity: "task",
    sources: {
      "task.parent_changed": taskSource({
        changes: (p) => ({ parent: oldNew(p, "oldParent", "newParent") }),
      }),
    },
  },
  "task.assignee_changed": {
    entity: "task",
    sources: {
      // One event per added user.
      "task.assignee_changed": taskSource({
        changes: (p) => ({
          assignee: {
            added: {
              id: value(p, "newAssigneeId"),
              name: value(p, "newAssignee"),
            },
          },
        }),
      }),
    },
  },
  "task.unassigned": {
    entity: "task",
    sources: {
      // One event per removed user.
      "task.unassigned": taskSource({
        changes: (p) => ({
          assignee: {
            removed: {
              id: value(p, "oldAssigneeId"),
              name: value(p, "oldAssignee"),
            },
          },
        }),
      }),
    },
  },
  "task.label_added": {
    entity: "task",
    sources: {
      "task.label_assigned": taskSource({ changes: labelChange }),
      "task.label_created": taskSource({ changes: labelChange }),
    },
  },
  "task.label_removed": {
    entity: "task",
    sources: {
      "task.label_unassigned": taskSource({ changes: labelChange }),
      "task.label_deleted": taskSource({ changes: labelChange }),
    },
  },
  "task.estimate_changed": {
    entity: "task",
    sources: {
      "task.estimate_changed": taskSource({
        changes: (p) => ({
          estimate: { old: pointOf(p, "old"), new: pointOf(p, "new") },
        }),
      }),
    },
  },
  "task.cycle_changed": {
    entity: "task",
    sources: {
      "task.cycle_changed": taskSource({
        changes: (p) => ({
          cycle: { old: cycleOf(p, "old"), new: cycleOf(p, "new") },
        }),
      }),
    },
  },
  "task.archived": {
    entity: "task",
    sources: { "task.archived": taskSource() },
  },
  "task.unarchived": {
    entity: "task",
    sources: { "task.unarchived": taskSource() },
  },
  "task.copied": {
    entity: "task",
    sources: {
      "task.copied": taskSource({
        changes: (p) => ({
          source: {
            taskId: value(p, "sourceTaskId"),
            key: value(p, "sourceTaskKey"),
            title: value(p, "sourceTaskTitle"),
          },
        }),
      }),
    },
  },
  "task.relation_created": {
    entity: "task",
    sources: {
      "task-relation.created": taskSource({ changes: relationChange }),
    },
  },
  "task.relation_deleted": {
    entity: "task",
    sources: {
      // A deleted task takes its relations along; task.deleted covers it.
      "task-relation.deleted": taskSource({
        changes: relationChange,
        skip: (p) => p.origin === "task_deleted",
      }),
    },
  },
  "task.link_created": {
    entity: "task",
    sources: { "task.link_created": taskSource({ changes: linkChange }) },
  },
  "task.link_updated": {
    entity: "task",
    sources: { "task.link_updated": taskSource({ changes: linkChange }) },
  },
  "task.link_deleted": {
    entity: "task",
    sources: { "task.link_deleted": taskSource({ changes: linkChange }) },
  },
  "task.attachment_added": {
    entity: "task",
    sources: {
      "task.attachment_added": taskSource({ changes: attachmentChange }),
    },
  },
  "task.attachment_removed": {
    entity: "task",
    sources: {
      "task.attachment_removed": taskSource({ changes: attachmentChange }),
    },
  },
  "task.vote_changed": {
    entity: "task",
    sources: {
      // The voter is the actor (a member or a public-board participant).
      "task.vote_changed": taskSource({
        changes: (p) => ({
          vote: {
            value: value(p, "value"),
            up: value(p, "up"),
            down: value(p, "down"),
          },
        }),
      }),
    },
  },
  "task.automation_applied": {
    entity: "project",
    sources: {
      "task.automation_applied": projectSource({
        actor: noActor,
        payloadData: (p) => ({
          projectId: value(p, "projectId"),
          rule: value(p, "rule"),
          taskIds: list(p, "taskIds"),
          count: value(p, "count"),
        }),
      }),
    },
  },

  // Comments (activity rows of type comment). Data carries `visibility`
  // (internal or public, B12 K10) and `origin` (app or public_board) so
  // consumers can tell internal discussion from public-board feedback.
  // Moderation's per-task refresh hints name no comment and are skipped.
  "comment.created": {
    entity: "comment",
    sources: { "comment.created": commentSource() },
  },
  "comment.updated": {
    entity: "comment",
    sources: {
      "comment.updated": commentSource({
        changes: (p) => namesOnly(p, "changes"),
      }),
    },
  },
  "comment.deleted": {
    entity: "comment",
    sources: {
      "comment.deleted": commentSource({
        payloadData: (p) => ({
          id: value(p, "id"),
          taskId: value(p, "taskId"),
          visibility: value(p, "visibility"),
          origin: value(p, "origin"),
        }),
      }),
    },
  },

  // Reactions (data is built from the payload and the actor)
  "reaction.added": {
    entity: "reaction",
    sources: {
      "reaction.added": source({
        entityId: (p) => str(p, "commentId") ?? str(p, "taskId"),
        locate: onTask,
        privacy: ["triage"],
      }),
    },
  },
  "reaction.removed": {
    entity: "reaction",
    sources: {
      "reaction.removed": source({
        entityId: (p) => str(p, "commentId") ?? str(p, "taskId"),
        locate: onTask,
        privacy: ["triage"],
      }),
    },
  },

  // Time tracking
  "time_entry.created": {
    entity: "time_entry",
    sources: {
      "time-entry.created": source({
        entityId: (p) => str(p, "timeEntryId"),
        locate: (p) => ({ taskId: str(p, "taskId") }),
        privacy: ["triage", "time_tracking"],
      }),
    },
  },

  // Cycles
  "cycle.created": {
    entity: "cycle",
    sources: { "cycle.created": cycleSource() },
  },
  "cycle.updated": {
    entity: "cycle",
    sources: {
      "cycle.updated": cycleSource({ changes: (p) => namesOnly(p, "changes") }),
    },
  },
  "cycle.archived": {
    entity: "cycle",
    sources: { "cycle.archived": cycleSource() },
  },
  "cycle.unarchived": {
    entity: "cycle",
    sources: { "cycle.unarchived": cycleSource() },
  },
  "cycle.deleted": {
    entity: "cycle",
    sources: {
      "cycle.deleted": cycleSource({
        payloadData: (p) => ({
          id: value(p, "cycleId"),
          projectId: value(p, "projectId"),
          name: value(p, "name"),
        }),
      }),
    },
  },
  "cycle.tasks_changed": {
    entity: "cycle",
    sources: {
      // Data: { cycleIds, taskIds, cycles } (snapshots loaded at enqueue).
      "cycle.tasks_changed": source({
        entityId: (p) => list(p, "cycleIds")[0] ?? null,
      }),
    },
  },

  // Modules
  "module.created": {
    entity: "module",
    sources: { "module.created": moduleSource() },
  },
  "module.updated": {
    entity: "module",
    sources: {
      "module.updated": moduleSource({
        changes: (p) => namesOnly(p, "changes"),
      }),
    },
  },
  "module.archived": {
    entity: "module",
    sources: { "module.archived": moduleSource() },
  },
  "module.unarchived": {
    entity: "module",
    sources: { "module.unarchived": moduleSource() },
  },
  "module.deleted": {
    entity: "module",
    sources: {
      "module.deleted": moduleSource({
        payloadData: (p) => ({
          id: value(p, "moduleId"),
          projectId: value(p, "projectId"),
          name: value(p, "name"),
        }),
      }),
    },
  },
  "module.tasks_changed": {
    entity: "module",
    sources: {
      "module.tasks_changed": moduleSource({
        changes: (p) => ({
          tasks: { added: list(p, "added"), removed: list(p, "removed") },
        }),
      }),
    },
  },
  "module.links_changed": {
    entity: "module",
    sources: {
      "module.links_changed": moduleSource({
        changes: (p) => ({
          link: { action: value(p, "action"), linkId: value(p, "linkId") },
        }),
      }),
    },
  },

  // Pages (public pages only)
  "page.created": {
    entity: "page",
    sources: { "page.created": pageSource() },
  },
  "page.updated": {
    entity: "page",
    sources: {
      "page.updated": pageSource({ changes: (p) => namesOnly(p, "changed") }),
    },
  },
  "page.content_updated": {
    entity: "page",
    sources: {
      "page.content_updated": pageSource({
        changes: () => ({ content: null }),
        coalesceKey: (p) => {
          const pageId = str(p, "pageId");
          return pageId ? `page:${pageId}` : null;
        },
      }),
    },
  },
  "page.locked": {
    entity: "page",
    sources: { "page.locked": pageSource() },
  },
  "page.unlocked": {
    entity: "page",
    sources: { "page.unlocked": pageSource() },
  },
  "page.access_changed": {
    entity: "page",
    sources: {
      "page.access_changed": pageSource({
        // Access is either public or private, so the old value is the other.
        changes: (p) => ({
          access: {
            old: p.access === "private" ? "public" : "private",
            new: value(p, "access"),
          },
        }),
      }),
    },
  },
  "page.archived": {
    entity: "page",
    sources: { "page.archived": pageSource() },
  },
  "page.unarchived": {
    entity: "page",
    sources: { "page.unarchived": pageSource() },
  },
  "page.moved": {
    entity: "page",
    sources: {
      "page.moved": pageSource({
        locate: (p) => ({
          projectId: str(p, "toProjectId") ?? str(p, "projectId"),
          workspaceId: str(p, "workspaceId"),
        }),
        changes: (p) => ({
          project: oldNew(p, "fromProjectId", "toProjectId"),
        }),
      }),
    },
  },
  "page.version_restored": {
    entity: "page",
    sources: {
      "page.version_restored": pageSource({
        changes: () => ({ content: null }),
      }),
    },
  },
  "page.deleted": {
    entity: "page",
    sources: {
      "page.deleted": pageSource({
        payloadData: (p) => ({
          id: value(p, "pageId"),
          projectId: value(p, "projectId"),
          title: value(p, "title"),
        }),
      }),
    },
  },

  // Views (shared views only)
  "view.created": {
    entity: "view",
    sources: { "view.created": viewSource() },
  },
  "view.updated": {
    entity: "view",
    sources: {
      "view.updated": viewSource({ changes: (p) => namesOnly(p, "changes") }),
    },
  },
  "view.deleted": {
    entity: "view",
    sources: {
      "view.deleted": viewSource({
        payloadData: (p) => ({
          id: value(p, "viewId"),
          projectId: value(p, "projectId"),
        }),
      }),
    },
  },

  // Intake
  "intake.item_created": {
    entity: "intake_item",
    sources: { "intake.item_created": intakeSource() },
  },
  "intake.item_updated": {
    entity: "intake_item",
    sources: {
      "intake.item_updated": intakeSource({
        changes: (p) => ({
          action: value(p, "action"),
          status: oldNew(p, "previousStatus", "status"),
        }),
      }),
    },
  },
  "intake.item_deleted": {
    entity: "intake_item",
    sources: {
      "intake.item_deleted": intakeSource({
        payloadData: (p) => ({
          id: value(p, "intakeItemId"),
          projectId: value(p, "projectId"),
          taskId: value(p, "taskId"),
        }),
      }),
    },
  },

  // Estimates
  "estimate.created": {
    entity: "estimate",
    sources: { "estimate.created": estimateSource() },
  },
  "estimate.updated": {
    entity: "estimate",
    sources: { "estimate.updated": estimateSource() },
  },
  "estimate.deleted": {
    entity: "estimate",
    sources: {
      "estimate.deleted": estimateSource({
        payloadData: (p) => ({
          id: value(p, "estimateId"),
          projectId: value(p, "projectId"),
        }),
      }),
    },
  },
  "estimate.activated": {
    entity: "estimate",
    sources: { "estimate.activated": estimateSource() },
  },
  "estimate.tasks_remapped": {
    entity: "estimate",
    sources: {
      "estimate.tasks_remapped": estimateSource({
        changes: (p) => ({ changedTaskCount: value(p, "changedTaskCount") }),
      }),
    },
  },
};

/**
 * Internal events that never leave Margaya, with the reason. Listed so the
 * completeness test can tell a deliberate exclusion from a forgotten event.
 */
export const WEBHOOK_EXCLUDED_EVENTS: Readonly<Record<string, string>> = {
  "task-relation.refresh": "UI refresh hint, not a change",
  "column.reordered": "ordering only",
  "module.reordered": "ordering only",
  "page.reordered": "ordering only",
  "favorite.changed": "personal data",
  "sticky.changed": "personal data",
  "quick_link.changed": "personal data",
  "home_preferences.changed": "personal data",
  "task_draft.changed": "private drafts",
  "notification.created": "personal inbox state",
  "notification.updated": "personal inbox state",
  "task.subscription_changed": "personal inbox state",
  "mcp.authorization_code_issued": "internal",
  "workspace.created": "before any webhook can exist",
  "workspace.settings_updated": "workspace configuration",
  "export.status_changed": "internal export progress (B13b)",
  "integration.created": "integration configuration",
  "integration.updated": "integration configuration",
  "integration.deleted": "integration configuration",
  "publication.participant_blocked": "concerns people outside the workspace",
  "publication.participant_unblocked": "concerns people outside the workspace",
  "instance.settings_updated": "instance-level, not a workspace event",
  "instance.admin_added": "instance-level, not a workspace event",
  "instance.admin_removed": "instance-level, not a workspace event",
};

function familyOf(name: string): WebhookFamily {
  const family = name.slice(0, name.indexOf("."));
  if (!(WEBHOOK_FAMILIES as readonly string[]).includes(family)) {
    throw new Error(`Webhook event ${name} has no known family`);
  }
  return family as WebhookFamily;
}

/** Every public event, in catalog order. */
export const WEBHOOK_EVENTS: readonly CatalogEvent[] = Object.entries(
  ENTRIES,
).map(([name, entry]) => ({
  name,
  family: familyOf(name),
  entity: entry.entity,
}));

export const WEBHOOK_EVENT_NAMES: ReadonlySet<string> = new Set(
  WEBHOOK_EVENTS.map((event) => event.name),
);

export type MappedSource = SourceSpec & {
  internal: string;
  event: string;
  entity: WebhookEntityType;
};

const SOURCES = new Map<string, MappedSource>();
for (const [event, entry] of Object.entries(ENTRIES)) {
  for (const [internal, spec] of Object.entries(entry.sources)) {
    if (SOURCES.has(internal)) {
      throw new Error(`Internal event ${internal} is mapped twice`);
    }
    SOURCES.set(internal, { ...spec, internal, event, entity: entry.entity });
  }
}

/** The internal events webhooks listen to. */
export const WEBHOOK_SOURCE_EVENTS: readonly string[] = [...SOURCES.keys()];

/** The public mapping of one internal event, or null when unmapped. */
export function webhookSourceFor(internalEvent: string): MappedSource | null {
  return SOURCES.get(internalEvent) ?? null;
}

/**
 * Every internal event name published in Margaya today. Kept in sync when a
 * slice adds an event: the completeness test fails when a name here is
 * neither mapped nor excluded, or when the code publishes a name that is
 * missing here.
 */
export const INTEGRATED_INTERNAL_EVENTS: readonly string[] = [
  ...WEBHOOK_SOURCE_EVENTS,
  ...Object.keys(WEBHOOK_EXCLUDED_EVENTS),
].sort();

// --- patterns ---------------------------------------------------------------

export class UnknownWebhookEventError extends Error {
  constructor(readonly pattern: string) {
    super(`Unknown event: ${pattern}`);
    this.name = "UnknownWebhookEventError";
  }
}

function isKnownPattern(pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return (WEBHOOK_FAMILIES as readonly string[]).includes(
      pattern.slice(0, -2),
    );
  }
  return WEBHOOK_EVENT_NAMES.has(pattern);
}

/**
 * Trimmed, deduplicated and sorted patterns. Throws
 * `UnknownWebhookEventError` for an unknown family or name, including
 * webhook.ping, which nobody subscribes to.
 */
export function validatePatterns(patterns: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!isKnownPattern(pattern)) throw new UnknownWebhookEventError(raw);
    unique.add(pattern);
  }
  return [...unique].sort();
}

/** Whether any pattern selects the public event (`*` never selects pings). */
export function matchesPatterns(
  patterns: readonly string[],
  event: string,
): boolean {
  if (!WEBHOOK_EVENT_NAMES.has(event)) return false;
  const family = `${event.slice(0, event.indexOf("."))}.*`;
  return patterns.some(
    (pattern) => pattern === "*" || pattern === family || pattern === event,
  );
}

/** The catalog as the events route returns it. */
export function webhookEventCatalog() {
  return {
    families: WEBHOOK_FAMILIES.map((family) => ({
      key: family,
      events: WEBHOOK_EVENTS.filter((event) => event.family === family).map(
        (event) => ({ name: event.name, entity: event.entity }),
      ),
    })),
  };
}
