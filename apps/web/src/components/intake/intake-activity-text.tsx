import {
  AlarmClock,
  AlarmClockOff,
  CircleCheck,
  CircleX,
  Copy,
  Inbox,
  RotateCcw,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatIntakeKey } from "@/lib/intake";
import { formatSnoozeDay } from "@/lib/intake-snooze";

// History lines of an intake request (B7 §3.7). The rows carry snapshots
// (column name, duplicate key), so they read well after later changes.

type Translate = (key: string, options?: Record<string, unknown>) => string;

type ActivityLike = { type: string; eventData?: unknown };

/** The row without an actor: the wake-up job ended a snooze. */
export const INTAKE_SNOOZE_ENDED = "intake_snooze_ended";

const iconClass = "h-4 w-4";

export function isIntakeActivity(type: string): boolean {
  return type.startsWith("intake_");
}

export function getIntakeActivityIcon(type: string): ReactNode {
  switch (type) {
    case "intake_submitted":
      return <Inbox className={iconClass} />;
    case "intake_accepted":
      return <CircleCheck className={iconClass} />;
    case "intake_declined":
      return <CircleX className={iconClass} />;
    case "intake_snoozed":
      return <AlarmClock className={iconClass} />;
    case "intake_unsnoozed":
    case INTAKE_SNOOZE_ENDED:
      return <AlarmClockOff className={iconClass} />;
    case "intake_duplicate":
      return <Copy className={iconClass} />;
    case "intake_reopened":
      return <RotateCcw className={iconClass} />;
    default:
      return null;
  }
}

function field(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The sentence after the actor's name, or null for other types. */
export function intakeActivityText(
  activity: ActivityLike,
  t: Translate,
): string | null {
  const data =
    activity.eventData &&
    typeof activity.eventData === "object" &&
    !Array.isArray(activity.eventData)
      ? (activity.eventData as Record<string, unknown>)
      : {};

  switch (activity.type) {
    case "intake_submitted": {
      const source = field(data, "source");
      return source && source !== "in_app"
        ? t("activity:intake.submittedVia", {
            source: t(`intake:source.${source}`, { defaultValue: source }),
          })
        : t("activity:intake.submitted");
    }
    case "intake_accepted": {
      const column = field(data, "columnName");
      return column
        ? t("activity:intake.accepted", { column })
        : t("activity:intake.acceptedBacklog");
    }
    case "intake_declined": {
      const note = field(data, "note");
      return note
        ? t("activity:intake.declinedWithReason", { note })
        : t("activity:intake.declined");
    }
    case "intake_snoozed": {
      const until = field(data, "until");
      return t("activity:intake.snoozed", {
        date: until ? formatSnoozeDay(until) : "",
      });
    }
    case "intake_unsnoozed":
      return t("activity:intake.unsnoozed");
    case INTAKE_SNOOZE_ENDED:
      return t("activity:intake.snoozeEnded");
    case "intake_duplicate": {
      const key = field(data, "duplicateKey");
      return key
        ? t("activity:intake.duplicate", { key: formatIntakeKey(key) })
        : t("activity:intake.duplicateDeleted");
    }
    case "intake_reopened":
      return t("activity:intake.reopened");
    default:
      return null;
  }
}
