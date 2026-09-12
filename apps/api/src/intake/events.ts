import { publishEvent } from "../events";
import type { IntakeItemResponse } from "./queries";
import type { IntakeSource, IntakeStatus } from "./status";

// Intake events (B7 §3.6). They feed intake's own subscribers (activity,
// submitter notifications, realtime hints) and later webhooks and inbox
// rules. Submitting never publishes task.created; accepting does.

export const INTAKE_ITEM_CREATED = "intake.item_created";
export const INTAKE_ITEM_UPDATED = "intake.item_updated";
export const INTAKE_ITEM_DELETED = "intake.item_deleted";

export type IntakeUpdateAction =
  | "accepted"
  | "declined"
  | "snoozed"
  | "unsnoozed"
  | "snooze_ended"
  | "duplicate"
  | "reopened"
  | "edited";

export type IntakeItemCreatedEvent = {
  intakeItemId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  /** The submitter. */
  userId: string | null;
  title: string;
  taskKey: string;
  source: IntakeSource;
};

export type IntakeItemUpdatedEvent = {
  intakeItemId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  /** The actor; null for the snooze wake-up job. */
  userId: string | null;
  action: IntakeUpdateAction;
  previousStatus: IntakeStatus;
  status: IntakeStatus;
  submittedBy: string | null;
  taskTitle: string;
  taskKey: string;
  columnName?: string | null;
  columnSlug?: string;
  note?: string | null;
  snoozedUntil?: string | null;
  duplicateOfTaskId?: string | null;
  duplicateKey?: string | null;
  duplicateTitle?: string | null;
};

export type IntakeItemDeletedEvent = {
  intakeItemId: string;
  taskId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
};

type UpdateExtras = Partial<
  Pick<
    IntakeItemUpdatedEvent,
    | "columnName"
    | "columnSlug"
    | "note"
    | "snoozedUntil"
    | "duplicateOfTaskId"
    | "duplicateKey"
    | "duplicateTitle"
  >
>;

/** Publishes intake.item_updated for an item read after the change. */
export async function publishIntakeItemUpdated({
  item,
  workspaceId,
  userId,
  action,
  previousStatus,
  extras = {},
}: {
  item: IntakeItemResponse;
  workspaceId: string;
  userId: string | null;
  action: IntakeUpdateAction;
  previousStatus: IntakeStatus;
  extras?: UpdateExtras;
}): Promise<void> {
  const payload: IntakeItemUpdatedEvent = {
    intakeItemId: item.id,
    taskId: item.taskId,
    projectId: item.projectId,
    workspaceId,
    userId,
    action,
    previousStatus,
    status: item.status,
    submittedBy: item.submittedBy?.id ?? null,
    taskTitle: item.task.title,
    taskKey: item.task.key,
    ...extras,
  };
  await publishEvent(INTAKE_ITEM_UPDATED, payload);
}
