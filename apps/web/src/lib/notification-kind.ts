import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlarmClock,
  AtSign,
  Bell,
  Bot,
  Building2,
  CalendarX,
  CircleCheck,
  CircleDot,
  CirclePlus,
  CircleX,
  Copy,
  Gauge,
  Megaphone,
  MessageSquare,
  Pencil,
  Redo2,
  Timer,
  UserRoundPlus,
} from "lucide-react";

export type NotificationKind = {
  icon: LucideIcon;
  /** A CSS colour that reads at 3:1 or better on cards in both themes. */
  color: string;
};

// Each type wears the hue of what it is about: people (work), talk (pages),
// state (status), time (amber) and trouble (destructive).
const KINDS: Record<string, NotificationKind> = {
  task_created: { icon: CirclePlus, color: "var(--area-inbox)" },
  task_assignee_changed: { icon: UserRoundPlus, color: "var(--area-work)" },
  task_status_changed: { icon: CircleDot, color: "var(--status-started-fg)" },
  task_comment: { icon: MessageSquare, color: "var(--area-pages)" },
  task_mention: { icon: AtSign, color: "var(--area-analytics)" },
  page_mention: { icon: AtSign, color: "var(--area-analytics)" },
  page_comment: { icon: MessageSquare, color: "var(--area-pages)" },
  page_updated: { icon: Pencil, color: "var(--area-settings)" },
  time_entry_created: { icon: Timer, color: "var(--area-home)" },
  due_date_reminder: { icon: AlarmClock, color: "var(--status-started-fg)" },
  task_overdue: { icon: CalendarX, color: "var(--destructive)" },
  task_updated: { icon: Pencil, color: "var(--area-settings)" },
  intake_accepted: { icon: CircleCheck, color: "var(--status-completed-fg)" },
  intake_declined: { icon: CircleX, color: "var(--status-cancelled-fg)" },
  intake_duplicate: { icon: Copy, color: "var(--area-settings)" },
  workspace_created: { icon: Building2, color: "var(--area-home)" },
  cycle_rollover: { icon: Redo2, color: "var(--area-work)" },
  flow_anomaly: { icon: Activity, color: "var(--area-analytics)" },
  project_update_posted: { icon: Megaphone, color: "var(--area-work)" },
  project_update_comment: { icon: MessageSquare, color: "var(--area-pages)" },
  project_update_reminder: {
    icon: Megaphone,
    color: "var(--status-started-fg)",
  },
  ai_approval_requested: { icon: Bot, color: "var(--area-work)" },
  ai_agent_reply: { icon: Bot, color: "var(--area-work)" },
  automation_notice: { icon: Bot, color: "var(--area-settings)" },
  ai_budget_warning: { icon: Gauge, color: "var(--status-started-fg)" },
};

const FALLBACK: NotificationKind = { icon: Bell, color: "var(--area-inbox)" };

/** The icon and hue of a notification type; unknown types get a bell. */
export function getNotificationKind(type: string): NotificationKind {
  return Object.hasOwn(KINDS, type) ? KINDS[type] : FALLBACK;
}
