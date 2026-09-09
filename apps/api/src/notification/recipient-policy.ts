// Who hears about which task event (B10 §3.2). Pure: the database side
// lives in recipients.ts, which feeds these rules with one task's
// assignees, subscriber rows and targeted users.

export type TaskEventKind =
  | "created"
  | "assigned"
  | "statusChanged"
  | "comment"
  | "mention"
  | "updated"
  | "timeEntry"
  | "intakeAccepted"
  | "intakeDeclined"
  | "intakeDuplicate";

/** Why a user is a candidate, strongest first. */
export type RecipientReason = "direct" | "mention" | "assignee" | "subscriber";

export type PreferenceKey =
  | "taskAssignmentEnabled"
  | "taskCommentEnabled"
  | "taskStatusChangeEnabled"
  | "taskUpdateEnabled"
  | "dueDateReminderEnabled";

type Audience = "assignees" | "watchers" | "direct" | "mentioned";

type KindPolicy = {
  type: string;
  audience: Audience;
};

export const TASK_EVENT_POLICY: Record<TaskEventKind, KindPolicy> = {
  created: { type: "task_created", audience: "assignees" },
  assigned: { type: "task_assignee_changed", audience: "direct" },
  statusChanged: { type: "task_status_changed", audience: "watchers" },
  comment: { type: "task_comment", audience: "watchers" },
  mention: { type: "task_mention", audience: "mentioned" },
  updated: { type: "task_updated", audience: "watchers" },
  timeEntry: { type: "time_entry_created", audience: "assignees" },
  // The outcome of an intake request, for its requester only (B7).
  intakeAccepted: { type: "intake_accepted", audience: "direct" },
  intakeDeclined: { type: "intake_declined", audience: "direct" },
  intakeDuplicate: { type: "intake_duplicate", audience: "direct" },
};

/**
 * The preference switch that gates a notification type, in-app and
 * external alike; null when no switch exists.
 */
export function preferenceKeyForType(
  type: string | null | undefined,
): PreferenceKey | null {
  switch (type) {
    case "task_assignee_changed":
    case "task_created":
      return "taskAssignmentEnabled";
    case "task_comment":
    case "task_mention":
    case "page_mention":
      return "taskCommentEnabled";
    case "task_status_changed":
    // A requester's intake outcomes are status changes of their request.
    case "intake_accepted":
    case "intake_declined":
    case "intake_duplicate":
      return "taskStatusChangeEnabled";
    case "task_updated":
      return "taskUpdateEnabled";
    case "due_date_reminder":
    case "task_overdue":
      return "dueDateReminderEnabled";
    default:
      return null;
  }
}

/** Direct kinds reach their targets even when they muted the task. */
export function isDirectKind(kind: TaskEventKind): boolean {
  const { audience } = TASK_EVENT_POLICY[kind];
  return audience === "direct" || audience === "mentioned";
}

const REASON_RANK: Record<RecipientReason, number> = {
  direct: 0,
  mention: 1,
  assignee: 2,
  subscriber: 3,
};

export type Candidate = { userId: string; reason: RecipientReason };

export type CandidateInput = {
  kind: TaskEventKind;
  assigneeIds: readonly string[];
  subscriberRows: readonly { userId: string; subscribed: boolean }[];
  mentionedIds?: readonly string[];
  directIds?: readonly string[];
  actorId?: string | null;
  excludeIds?: readonly string[];
};

/**
 * Candidates for one event before the membership and preference checks:
 * the kind's audience with each user's strongest reason, minus the actor,
 * the exclusions and, for non-direct kinds, muted users. Ordered by reason
 * strength, then user id.
 */
export function buildCandidates(input: CandidateInput): Candidate[] {
  const { audience } = TASK_EVENT_POLICY[input.kind];
  const best = new Map<string, RecipientReason>();
  const offer = (userId: string, reason: RecipientReason) => {
    if (!userId) return;
    const current = best.get(userId);
    if (!current || REASON_RANK[reason] < REASON_RANK[current]) {
      best.set(userId, reason);
    }
  };

  if (audience === "direct") {
    for (const id of input.directIds ?? []) offer(id, "direct");
  } else if (audience === "mentioned") {
    for (const id of input.mentionedIds ?? []) offer(id, "mention");
  } else {
    for (const id of input.assigneeIds) offer(id, "assignee");
    if (audience === "watchers") {
      for (const row of input.subscriberRows) {
        if (row.subscribed) offer(row.userId, "subscriber");
      }
    }
  }

  const removed = new Set(input.excludeIds ?? []);
  if (input.actorId) removed.add(input.actorId);
  if (!isDirectKind(input.kind)) {
    for (const row of input.subscriberRows) {
      if (!row.subscribed) removed.add(row.userId);
    }
  }

  return [...best.entries()]
    .filter(([userId]) => !removed.has(userId))
    .map(([userId, reason]) => ({ userId, reason }))
    .sort(
      (a, b) =>
        REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
}
