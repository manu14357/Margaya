import { subscribeToEvent } from "../events";
import { relationPerspective } from "../task-relation/types";
import { insertTaskActivity, recordDescriptionEdit } from "./insert-activity";
import { loadTaskSnapshots, type TaskSnapshot } from "./task-snapshot";

// Task-detail history: start date, labels, description, relations, parent,
// links, attachments and copies. Rows keep snapshots (keys, titles, names),
// so they stay readable after renames and deletes. Payloads without a user
// are system changes and are not attributed to anyone, so they write
// nothing. Other writers already cover created, moved, status, priority,
// assignees, due date, title, cycle, module and estimate changes.

type Actor = { taskId?: string | null; userId?: string | null };

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function otherTask(id: string, snapshot: TaskSnapshot | undefined) {
  return {
    otherTaskId: id,
    otherTaskKey: snapshot?.key ?? null,
    otherTaskTitle: snapshot?.title ?? null,
    otherProjectId: snapshot?.projectId ?? null,
  };
}

// --- start date, labels, description ------------------------------------

subscribeToEvent<Actor & { oldStartDate?: unknown; newStartDate?: unknown }>(
  "task.start_date_changed",
  async (data) => {
    if (!data.taskId || !data.userId) return;
    const oldStartDate = isoOrNull(data.oldStartDate);
    const newStartDate = isoOrNull(data.newStartDate);
    if (oldStartDate === newStartDate) return;
    await insertTaskActivity({
      taskId: data.taskId,
      type: "start_date_changed",
      userId: data.userId,
      eventData: { oldStartDate, newStartDate },
    });
  },
);

type LabelEvent = Actor & { label?: { name?: unknown; color?: unknown } };

function labelEventData(data: LabelEvent) {
  const name = textOrNull(data.label?.name);
  return name ? { name, color: textOrNull(data.label?.color) } : null;
}

for (const [eventName, type] of [
  ["task.label_assigned", "label_added"],
  ["task.label_created", "label_added"],
  ["task.label_unassigned", "label_removed"],
] as const) {
  subscribeToEvent<LabelEvent>(eventName, async (data) => {
    const label = labelEventData(data);
    if (!data.taskId || !data.userId || !label) return;
    await insertTaskActivity({
      taskId: data.taskId,
      type,
      userId: data.userId,
      eventData: label,
    });
  });
}

subscribeToEvent<
  Actor & { oldDescription?: string | null; newDescription?: string | null }
>("task.description_changed", async (data) => {
  if (!data.taskId || !data.userId) return;
  if ((data.oldDescription ?? "") === (data.newDescription ?? "")) return;
  // The text itself is never copied into history.
  await recordDescriptionEdit(data.taskId, data.userId);
});

// --- relations and parent -------------------------------------------------

type RelationEvent = Actor & {
  sourceTaskId?: string;
  targetTaskId?: string;
  relationType?: string;
  origin?: string;
  sourceTaskKey?: string | null;
  sourceTaskTitle?: string | null;
  targetTaskKey?: string | null;
  targetTaskTitle?: string | null;
  projectId?: string;
  targetProjectId?: string | null;
};

/** Snapshots from the payload; older publishers get them loaded. */
async function relationSnapshots(
  data: RelationEvent,
  source: string,
  target: string,
) {
  if (
    data.sourceTaskKey &&
    data.sourceTaskTitle != null &&
    data.targetTaskKey &&
    data.targetTaskTitle != null &&
    data.projectId &&
    data.targetProjectId
  ) {
    return new Map<string, TaskSnapshot>([
      [
        source,
        {
          id: source,
          key: data.sourceTaskKey,
          title: data.sourceTaskTitle,
          projectId: data.projectId,
        },
      ],
      [
        target,
        {
          id: target,
          key: data.targetTaskKey,
          title: data.targetTaskTitle,
          projectId: data.targetProjectId,
        },
      ],
    ]);
  }
  return loadTaskSnapshots([source, target]);
}

function parentRef(snapshot: TaskSnapshot | undefined, id: string) {
  return {
    id,
    key: snapshot?.key ?? null,
    title: snapshot?.title ?? null,
    projectId: snapshot?.projectId ?? null,
  };
}

async function recordRelationChange(data: RelationEvent, added: boolean) {
  const { sourceTaskId: source, targetTaskId: target, userId } = data;
  // A deleted task takes its relations along without touching other tasks.
  if (!source || !target || !userId || data.origin === "task_deleted") return;
  const snapshots = await relationSnapshots(data, source, target);

  if (data.relationType === "subtask") {
    await insertTaskActivity({
      taskId: source,
      type: added ? "subtask_added" : "subtask_removed",
      userId,
      eventData: otherTask(target, snapshots.get(target)),
    });
    // A parent change writes its own single row (task.parent_changed), and a
    // copy is summarized by its copied_from row.
    if (data.origin === "parent_change" || (added && data.origin === "copy")) {
      return;
    }
    const parent = parentRef(snapshots.get(source), source);
    await insertTaskActivity({
      taskId: target,
      type: "parent_changed",
      userId,
      eventData: added
        ? { oldParent: null, newParent: parent }
        : { oldParent: parent, newParent: null },
    });
    return;
  }

  const relationType = data.relationType ?? "related";
  const type = added ? "relation_added" : "relation_removed";
  await insertTaskActivity({
    taskId: source,
    type,
    userId,
    eventData: {
      relation: relationPerspective(relationType, true),
      ...otherTask(target, snapshots.get(target)),
    },
  });
  await insertTaskActivity({
    taskId: target,
    type,
    userId,
    eventData: {
      relation: relationPerspective(relationType, false),
      ...otherTask(source, snapshots.get(source)),
    },
  });
}

subscribeToEvent<RelationEvent>("task-relation.created", (data) =>
  recordRelationChange(data, true),
);
subscribeToEvent<RelationEvent>("task-relation.deleted", (data) =>
  recordRelationChange(data, false),
);

type ParentRef = { id?: string } | null | undefined;

subscribeToEvent<Actor & { oldParent?: ParentRef; newParent?: ParentRef }>(
  "task.parent_changed",
  async (data) => {
    if (!data.taskId || !data.userId) return;
    const oldParent = data.oldParent?.id ? data.oldParent : null;
    const newParent = data.newParent?.id ? data.newParent : null;
    if ((oldParent?.id ?? null) === (newParent?.id ?? null)) return;
    await insertTaskActivity({
      taskId: data.taskId,
      type: "parent_changed",
      userId: data.userId,
      eventData: { oldParent, newParent },
    });
  },
);

// --- links, attachments, copies -------------------------------------------

type LinkEvent = Actor & {
  linkId?: string;
  url?: string;
  title?: string | null;
  host?: string;
  oldUrl?: string;
  oldTitle?: string | null;
};

for (const [eventName, type] of [
  ["task.link_created", "link_added"],
  ["task.link_updated", "link_updated"],
  ["task.link_deleted", "link_removed"],
] as const) {
  subscribeToEvent<LinkEvent>(eventName, async (data) => {
    if (!data.taskId || !data.userId) return;
    await insertTaskActivity({
      taskId: data.taskId,
      type,
      userId: data.userId,
      eventData: {
        linkId: data.linkId ?? null,
        url: data.url ?? null,
        title: data.title ?? null,
        host: data.host ?? null,
        ...(type === "link_updated"
          ? { oldUrl: data.oldUrl ?? null, oldTitle: data.oldTitle ?? null }
          : {}),
      },
    });
  });
}

type AttachmentEvent = Actor & {
  attachmentId?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
};

for (const [eventName, type] of [
  ["task.attachment_added", "attachment_added"],
  ["task.attachment_removed", "attachment_removed"],
] as const) {
  subscribeToEvent<AttachmentEvent>(eventName, async (data) => {
    if (!data.taskId || !data.userId) return;
    await insertTaskActivity({
      taskId: data.taskId,
      type,
      userId: data.userId,
      eventData: {
        attachmentId: data.attachmentId ?? null,
        filename: data.filename ?? null,
        size: data.size ?? null,
        mimeType: data.mimeType ?? null,
      },
    });
  });
}

subscribeToEvent<
  Actor & {
    projectId?: string;
    sourceTaskId?: string;
    sourceProjectId?: string;
    sourceTaskKey?: string;
    sourceTaskTitle?: string;
    copyTaskKey?: string;
    copyTaskTitle?: string;
    included?: string[];
  }
>("task.copied", async (data) => {
  if (!data.taskId || !data.userId) return;
  await insertTaskActivity({
    taskId: data.taskId,
    type: "copied_from",
    userId: data.userId,
    eventData: {
      sourceTaskId: data.sourceTaskId ?? null,
      sourceTaskKey: data.sourceTaskKey ?? null,
      sourceTaskTitle: data.sourceTaskTitle ?? null,
      sourceProjectId: data.sourceProjectId ?? null,
      included: data.included ?? [],
    },
  });
  // Skipped (no row, no error) when the source is gone.
  if (!data.sourceTaskId) return;
  await insertTaskActivity({
    taskId: data.sourceTaskId,
    type: "copied_to",
    userId: data.userId,
    eventData: {
      copyTaskId: data.taskId,
      copyTaskKey: data.copyTaskKey ?? null,
      copyTaskTitle: data.copyTaskTitle ?? null,
      copyProjectId: data.projectId ?? null,
    },
  });
});
