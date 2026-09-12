import { HTTPException } from "hono/http-exception";

// The intake status model (B7 §2.3). Pure: SQL mirrors live in queries.ts.

export const INTAKE_STATUSES = [
  "pending",
  "snoozed",
  "accepted",
  "declined",
  "duplicate",
] as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const OPEN_INTAKE_STATUSES = [
  "pending",
  "snoozed",
] as const satisfies readonly IntakeStatus[];

export const CLOSED_INTAKE_STATUSES = [
  "accepted",
  "declined",
  "duplicate",
] as const satisfies readonly IntakeStatus[];

export const INTAKE_TABS = ["open", "closed"] as const;

export type IntakeTab = (typeof INTAKE_TABS)[number];

export const INTAKE_SOURCES = [
  "in_app",
  "api",
  "public_board",
  "email",
  "form",
] as const;

export type IntakeSource = (typeof INTAKE_SOURCES)[number];

/** Sources this slice writes; the others are reserved. */
export const CREATABLE_INTAKE_SOURCES = [
  "in_app",
  "api",
] as const satisfies readonly IntakeSource[];

export const INTAKE_ACTIONS = [
  "accept",
  "decline",
  "snooze",
  "unsnooze",
  "duplicate",
  "reopen",
] as const;

export type IntakeAction = (typeof INTAKE_ACTIONS)[number];

export function isIntakeStatus(value: unknown): value is IntakeStatus {
  return (
    typeof value === "string" &&
    (INTAKE_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenIntakeStatus(status: IntakeStatus): boolean {
  return status === "pending" || status === "snoozed";
}

/** Statuses a tab lists, and the ones its default filter shows. */
export function tabStatuses(tab: IntakeTab): readonly IntakeStatus[] {
  return tab === "open" ? OPEN_INTAKE_STATUSES : CLOSED_INTAKE_STATUSES;
}

export function defaultTabStatuses(tab: IntakeTab): readonly IntakeStatus[] {
  return tab === "open" ? ["pending"] : CLOSED_INTAKE_STATUSES;
}

type StoredState = { status: string; snoozedUntil: Date | null };

/**
 * The status every read, filter and transition uses: a snooze whose time has
 * passed is pending again, even before the wake-up job normalizes the row.
 */
export function effectiveStatus(row: StoredState, now: Date): IntakeStatus {
  if (
    row.status === "snoozed" &&
    row.snoozedUntil !== null &&
    row.snoozedUntil.getTime() <= now.getTime()
  ) {
    return "pending";
  }
  return isIntakeStatus(row.status) ? row.status : "pending";
}

export const TRANSITION_MESSAGES = {
  alreadyAccepted: "This request was already accepted",
  reopenFirst: "Reopen this request first",
  notSnoozed: "This request isn't snoozed",
  alreadyOpen: "This request is already open",
} as const;

/**
 * The status an action leads to from the effective status, or the 409
 * message that refuses it (§2.3 transition table).
 */
export function transitionTarget(
  from: IntakeStatus,
  action: IntakeAction,
): { ok: true; to: IntakeStatus } | { ok: false; message: string } {
  if (from === "accepted") {
    return { ok: false, message: TRANSITION_MESSAGES.alreadyAccepted };
  }

  const open = isOpenIntakeStatus(from);
  switch (action) {
    case "accept":
      return open
        ? { ok: true, to: "accepted" }
        : { ok: false, message: TRANSITION_MESSAGES.reopenFirst };
    case "decline":
      return open
        ? { ok: true, to: "declined" }
        : { ok: false, message: TRANSITION_MESSAGES.reopenFirst };
    case "snooze":
      return open
        ? { ok: true, to: "snoozed" }
        : { ok: false, message: TRANSITION_MESSAGES.reopenFirst };
    case "duplicate":
      return open
        ? { ok: true, to: "duplicate" }
        : { ok: false, message: TRANSITION_MESSAGES.reopenFirst };
    case "unsnooze":
      return from === "snoozed"
        ? { ok: true, to: "pending" }
        : { ok: false, message: TRANSITION_MESSAGES.notSnoozed };
    case "reopen":
      return open
        ? { ok: false, message: TRANSITION_MESSAGES.alreadyOpen }
        : { ok: true, to: "pending" };
  }
}

/** The target status of an allowed action; throws the listed 409 otherwise. */
export function assertTransition(
  from: IntakeStatus,
  action: IntakeAction,
): IntakeStatus {
  const result = transitionTarget(from, action);
  if (!result.ok) {
    throw new HTTPException(409, { message: result.message });
  }
  return result.to;
}

export type TransitionFields = {
  status: IntakeStatus;
  snoozedUntil: Date | null;
  duplicateOfTaskId: string | null;
  resolutionNote: string | null;
};

/**
 * Field effects of a transition (§2.3): every transition clears the fields
 * that belong to other statuses; the triager stamp is applied by the caller.
 */
export function transitionFields(
  action: IntakeAction,
  input: {
    snoozedUntil?: Date;
    duplicateOfTaskId?: string;
    note?: string | null;
  } = {},
): TransitionFields {
  const cleared = {
    snoozedUntil: null,
    duplicateOfTaskId: null,
    resolutionNote: null,
  };
  switch (action) {
    case "accept":
      return { ...cleared, status: "accepted" };
    case "decline":
      return {
        ...cleared,
        status: "declined",
        resolutionNote: input.note ?? null,
      };
    case "snooze":
      return {
        ...cleared,
        status: "snoozed",
        snoozedUntil: input.snoozedUntil ?? null,
      };
    case "duplicate":
      return {
        ...cleared,
        status: "duplicate",
        duplicateOfTaskId: input.duplicateOfTaskId ?? null,
        resolutionNote: input.note ?? null,
      };
    case "unsnooze":
    case "reopen":
      return { ...cleared, status: "pending" };
  }
}

/** Trims a decline or duplicate note; empty means none. */
export function normalizeNote(note: string | undefined | null): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
export const MIN_SNOOZE_MS = MINUTE_MS;
export const MAX_SNOOZE_MS = 366 * DAY_MS;

// An ISO 8601 date-time with an explicit offset or Z. A bare local time would
// be read in the server's zone, which is never what the viewer meant.
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export const SNOOZE_MESSAGES = {
  invalid: "Pick a valid date",
  past: "Pick a time in the future",
  tooFar: "You can snooze for up to a year",
} as const;

/**
 * Parses a snooze end: later than a minute from now and at most 366 days
 * away. Throws a 400 with the matching message otherwise.
 */
export function parseSnoozeUntil(value: string, now: Date): Date {
  const trimmed = value.trim();
  const parsed = ISO_WITH_OFFSET.test(trimmed) ? new Date(trimmed) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new HTTPException(400, { message: SNOOZE_MESSAGES.invalid });
  }
  const delta = parsed.getTime() - now.getTime();
  if (delta <= MIN_SNOOZE_MS) {
    throw new HTTPException(400, { message: SNOOZE_MESSAGES.past });
  }
  if (delta > MAX_SNOOZE_MS) {
    throw new HTTPException(400, { message: SNOOZE_MESSAGES.tooFar });
  }
  return parsed;
}
