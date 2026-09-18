import * as Sentry from "@sentry/node";
import { Cron } from "croner";
import { runAuditLogRetention } from "../audit-log/retention";
import { wakeSnoozedIntakeItems } from "../intake/snooze-job";
import { sendNotificationDigests } from "../notification-email/digest-job";
import { flushNotificationEmails } from "../notification-email/flush";
import { runProjectAutomations } from "../project-automation/job";
import { runExportCleanup } from "../task-export/cleanup";
import { recoverExports } from "../task-export/runner";
import { runTrashPurge } from "../trash/purge-job";
import { sweepWebhookDeliveries } from "../webhook/dispatch/dispatcher";
import { runWebhookRetention } from "../webhook/retention";
import { checkDueDateReminders } from "./due-date-reminders";
import { resurfaceSnoozedNotifications } from "./notification-unsnooze";
import { checkProjectWebhookReminders } from "./project-webhook-reminders";
import { reconcileWorkspaceSeats } from "./seat-reconciliation";
import { checkTrialReminders } from "./trial-reminders";

const jobs: Cron[] = [];

type JobOutcome = { degraded?: boolean };

// Cron jobs swallow their operational failures (per-item try/catch) so they
// can keep processing the rest of the batch. Reporting Sentry status purely
// from the thrown-rejection channel would always show "ok" for any partially
// failed run. Inspect the returned outcome instead so handled failures light
// up the monitor without aborting the rest of the work. Unexpected throws are
// captured as exception events and swallowed so one bad tick can't take down
// the scheduler via an unhandled rejection.
function withCheckIn<T>(name: string, fn: () => Promise<T>) {
  return async (): Promise<void> => {
    const checkInId = Sentry.captureCheckIn({
      monitorSlug: name,
      status: "in_progress",
    });
    try {
      const result = await fn();
      const degraded = Boolean(
        (result as JobOutcome | null | undefined)?.degraded,
      );
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: degraded ? "error" : "ok",
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "cron", job: name } });
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: name,
        status: "error",
      });
      console.error(`Cron job ${name} failed`, error);
    }
  };
}

export function initializeScheduler(): void {
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("due-date-reminders", checkDueDateReminders),
    ),
  );
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("project-webhook-reminders", checkProjectWebhookReminders),
    ),
  );
  jobs.push(
    new Cron(
      "17 * * * *",
      withCheckIn("seat-reconciliation", reconcileWorkspaceSeats),
    ),
  );
  jobs.push(
    new Cron("23 * * * *", withCheckIn("trial-reminders", checkTrialReminders)),
  );
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("notification-unsnooze", () =>
        resurfaceSnoozedNotifications(),
      ),
    ),
  );
  jobs.push(
    new Cron(
      "*/5 * * * *",
      withCheckIn("intake-snooze-wakeup", wakeSnoozedIntakeItems),
    ),
  );
  // Batched notification emails (EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS);
  // runs even with a window of 0 so rows queued before a change still go.
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("notification-email-flush", () => flushNotificationEmails()),
    ),
  );
  jobs.push(
    new Cron(
      "*/15 * * * *",
      withCheckIn("notification-digest", () => sendNotificationDigests()),
    ),
  );
  // Minute 41 keeps clear of the other hourly jobs (:17 and :23).
  jobs.push(
    new Cron(
      "41 * * * *",
      withCheckIn("project-automations", () => runProjectAutomations()),
    ),
  );
  // Requeues exports a crash left behind and starts queued ones on this
  // instance too; safe on every instance (row locks, no lease needed).
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("task-export-recovery", () => recoverExports()),
    ),
  );
  jobs.push(
    new Cron(
      "47 * * * *",
      withCheckIn("task-export-cleanup", () => runExportCleanup()),
    ),
  );
  // Returns crashed webhook claims and sends retries that fell due; safe on
  // every instance (row locks). Retention runs on one instance at a time.
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("webhook-sweep", () => sweepWebhookDeliveries()),
    ),
  );
  jobs.push(
    new Cron(
      "53 * * * *",
      withCheckIn("webhook-retention", () => runWebhookRetention()),
    ),
  );
  // Audit entries older than AUDIT_LOG_RETENTION_DAYS, on one instance.
  jobs.push(
    new Cron(
      "11 * * * *",
      withCheckIn("audit-log-retention", () => runAuditLogRetention()),
    ),
  );
  // Trash older than TRASH_RETENTION_DAYS, on one instance at a time (C7).
  jobs.push(
    new Cron(
      "29 * * * *",
      withCheckIn("trash-purge", () => runTrashPurge()),
    ),
  );
  console.log(
    "⏰ Scheduler started (snoozed notifications, batched notification emails, export recovery and the webhook sweep every minute, reminders and intake snooze wake-ups every 5 minutes, notification digests every 15 minutes, seat reconciliation, trial reminders, project automations, export cleanup, webhook retention, audit log retention and the trash purge hourly)",
  );
}

export function shutdownScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
