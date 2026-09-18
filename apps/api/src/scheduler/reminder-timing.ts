const MINUTE_MS = 60 * 1000;

export const REMINDER_WINDOW_MINUTES = 10;

/**
 * The `task_reminder_sent.reminder_type` of a reminder sent to one assignee,
 * so each person gets each reminder once per task. Rows from before
 * per-person reminders (no user suffix) are ignored.
 */
export function userReminderType(
  reminderType: "configured_before" | "overdue",
  userId: string,
): string {
  return `${reminderType}:user:${userId}`;
}

export function isReminderDue({
  dueDate,
  leadTimeMinutes,
  now,
}: {
  dueDate: Date;
  leadTimeMinutes: number;
  now: Date;
}) {
  const targetTime = dueDate.getTime() - leadTimeMinutes * MINUTE_MS;
  const elapsedSinceTarget = now.getTime() - targetTime;

  return (
    elapsedSinceTarget >= 0 &&
    elapsedSinceTarget <= REMINDER_WINDOW_MINUTES * MINUTE_MS
  );
}
