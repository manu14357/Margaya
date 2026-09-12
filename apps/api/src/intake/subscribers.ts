import { subscribeToEvent } from "../events";
import { notifyTaskEvent } from "../notification/recipients";
import { insertTaskActivity } from "../task-activity/insert-activity";
import { broadcastToProject } from "../ws";
import {
  INTAKE_ITEM_CREATED,
  INTAKE_ITEM_DELETED,
  INTAKE_ITEM_UPDATED,
  type IntakeItemCreatedEvent,
  type IntakeItemUpdatedEvent,
  type IntakeUpdateAction,
} from "./events";

// Intake's own reactions (B7 §3.7, §5): activity rows, the requester's
// outcome notifications and realtime hints. Imported by the router for its
// side effects.

type Initiated = { initiatorId?: string };

const ACTIVITY_TYPES: Partial<Record<IntakeUpdateAction, string>> = {
  accepted: "intake_accepted",
  declined: "intake_declined",
  snoozed: "intake_snoozed",
  unsnoozed: "intake_unsnoozed",
  snooze_ended: "intake_snooze_ended",
  duplicate: "intake_duplicate",
  reopened: "intake_reopened",
};

function activityData(event: IntakeItemUpdatedEvent): Record<string, unknown> {
  switch (event.action) {
    case "accepted":
      return { columnName: event.columnName ?? null, status: event.columnSlug };
    case "declined":
      return { note: event.note ?? null };
    case "snoozed":
      return { until: event.snoozedUntil ?? null };
    case "duplicate":
      return {
        duplicateOfTaskId: event.duplicateOfTaskId ?? null,
        duplicateKey: event.duplicateKey ?? null,
        duplicateTitle: event.duplicateTitle ?? null,
        note: event.note ?? null,
      };
    default:
      return {};
  }
}

subscribeToEvent<IntakeItemCreatedEvent>(INTAKE_ITEM_CREATED, async (event) => {
  await insertTaskActivity({
    taskId: event.taskId,
    type: "intake_submitted",
    userId: event.userId,
    eventData: { source: event.source },
  });
});

subscribeToEvent<IntakeItemUpdatedEvent>(INTAKE_ITEM_UPDATED, async (event) => {
  // Edits are logged by the task controllers they go through.
  const type = ACTIVITY_TYPES[event.action];
  if (!type) return;
  await insertTaskActivity({
    taskId: event.taskId,
    type,
    userId: event.action === "snooze_ended" ? null : event.userId,
    eventData: activityData(event),
  });
});

/** The stored English text of an outcome notification, for external delivery. */
export function outcomeNotificationText(event: IntakeItemUpdatedEvent): {
  kind: "intakeAccepted" | "intakeDeclined" | "intakeDuplicate";
  title: string;
  content: string;
} | null {
  const title = event.taskTitle;
  switch (event.action) {
    case "accepted":
      return {
        kind: "intakeAccepted",
        title: "Your request was accepted",
        content: event.columnName
          ? `${event.taskKey} "${title}" is now on the board in ${event.columnName}.`
          : `${event.taskKey} "${title}" is now in the backlog.`,
      };
    case "declined":
      return {
        kind: "intakeDeclined",
        title: "Your request was declined",
        content: event.note
          ? `"${title}" was declined. Reason: ${event.note}`
          : `"${title}" was declined.`,
      };
    case "duplicate":
      return {
        kind: "intakeDuplicate",
        title: "Your request is a duplicate",
        content: `"${title}" is already covered by ${event.duplicateKey ?? "another task"} "${event.duplicateTitle ?? ""}".`,
      };
    default:
      return null;
  }
}

subscribeToEvent<IntakeItemUpdatedEvent>(INTAKE_ITEM_UPDATED, async (event) => {
  // Only the three outcomes a requester cares about. The recipients helper
  // drops the actor (no note about a decision on your own request), people
  // who left the workspace and the "task status changes" switch.
  const text = outcomeNotificationText(event);
  if (!text || !event.submittedBy) return;
  const outcome: Record<string, unknown> =
    event.action === "accepted"
      ? { columnName: event.columnName ?? null }
      : event.action === "declined"
        ? { note: event.note ?? null }
        : {
            duplicateKey: event.duplicateKey ?? null,
            duplicateTitle: event.duplicateTitle ?? null,
            duplicateTaskId: event.duplicateOfTaskId ?? null,
          };
  await notifyTaskEvent({
    taskId: event.taskId,
    kind: text.kind,
    actorId: event.userId,
    directIds: [event.submittedBy],
    title: text.title,
    content: text.content,
    eventData: {
      intakeItemId: event.intakeItemId,
      taskTitle: event.taskTitle,
      taskKey: event.taskKey,
      // The queue the request was submitted to.
      projectId: event.projectId,
      workspaceId: event.workspaceId,
      ...outcome,
    },
  });
});

// Refetch hints only, never entity data, so the in-memory and Redis
// adapters carry them unchanged.
for (const eventName of [
  INTAKE_ITEM_CREATED,
  INTAKE_ITEM_UPDATED,
  INTAKE_ITEM_DELETED,
]) {
  subscribeToEvent<{ projectId?: string; taskId?: string } & Initiated>(
    eventName,
    async ({ projectId, taskId, initiatorId }) => {
      if (!projectId) return;
      broadcastToProject(
        projectId,
        { type: "INTAKE_UPDATED", projectId, taskId },
        initiatorId,
      );
    },
  );
}
