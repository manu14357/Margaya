import * as Sentry from "@sentry/node";
import { Cron } from "croner";
import { enableAgentRunner, maintainAgentRuns } from "../ai-agent/runner";
import { runAgentSchedules } from "../ai-agent/schedules";
import { runEmbeddingIndexer } from "../ai-memory/indexer";
import { runApiRequestLogRetention } from "../api-key/request-log";
import { runAuditLogRetention } from "../audit-log/retention";
import {
  runAutomationDueDates,
  runAutomationRunRetention,
} from "../automation-rule/jobs";
import { runFlowAlerts } from "../delivery/flow-alert-job";
import { runInstanceAuditRetention } from "../instance-admin/audit-retention";
import { wakeSnoozedIntakeItems } from "../intake/snooze-job";
import { sendNotificationDigests } from "../notification-email/digest-job";
import { flushNotificationEmails } from "../notification-email/flush";
import { runCycleRollover } from "../project-automation/cycle-rollover";
import { runProjectAutomations } from "../project-automation/job";
import { runSearchIndexBackfill } from "../search/backfill";
import { sweepAbandonedUploads } from "../storage/upload-sweep";
import { runExportCleanup } from "../task-export/cleanup";
import { recoverExports } from "../task-export/runner";
import { runTaskRecurrence } from "../task-recurrence/job";
import { runTrashPurge } from "../trash/purge-job";
import { sweepWebhookDeliveries } from "../webhook/dispatch/dispatcher";
import { runWebhookRetention } from "../webhook/retention";
import { runWorkspaceDeletionPurge } from "../workspace-deletion/purge-job";
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
  // AI agent runs (ai-agent/runner.ts): queued runs start on enqueue from
  // now on; every minute, runs a crash left behind are requeued and
  // approvals older than 24 hours expire. Safe on every instance (row locks).
  enableAgentRunner();
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("agent-runs", () => maintainAgentRuns()),
    ),
  );
  // Agent schedules (cron in a time zone): due ones queue a run. Safe on
  // every instance: each slot is claimed with a compare-and-set.
  jobs.push(
    new Cron(
      "* * * * *",
      withCheckIn("agent-schedules", () => runAgentSchedules()),
    ),
  );
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
  // Automation rules: "due date passed" fires hourly (once per task and due
  // date); the run log keeps AUTOMATION_RUN_RETENTION_DAYS (default 30).
  jobs.push(
    new Cron(
      "13 * * * *",
      withCheckIn("automation-due-dates", () => runAutomationDueDates()),
    ),
  );
  jobs.push(
    new Cron(
      "47 3 * * *",
      withCheckIn("automation-run-retention", () =>
        runAutomationRunRetention(),
      ),
    ),
  );
  // Opt-in cycle rollover; cycles end at the workspace's local midnight, so
  // an hourly pass moves their work within the hour. Minute 5 is free.
  jobs.push(
    new Cron(
      "5 * * * *",
      withCheckIn("cycle-rollover", () => runCycleRollover()),
    ),
  );
  // Scheduled repeating tasks: the next instance once its date begins in the
  // workspace's time zone. Zones start their day on the hour, half hour or
  // quarter hour, so a quarter-hourly pass is never more than 15 minutes late.
  jobs.push(
    new Cron(
      "7,22,37,52 * * * *",
      withCheckIn("task-recurrence", () => runTaskRecurrence()),
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
  // Instance audit entries older than INSTANCE_AUDIT_LOG_RETENTION_DAYS.
  jobs.push(
    new Cron(
      "13 * * * *",
      withCheckIn("instance-audit-retention", () =>
        runInstanceAuditRetention(),
      ),
    ),
  );
  // API key request log rows older than API_REQUEST_LOG_RETENTION_DAYS.
  jobs.push(
    new Cron(
      "19 * * * *",
      withCheckIn("api-request-log-retention", () =>
        runApiRequestLogRetention(),
      ),
    ),
  );
  // Opt-in flow anomaly alerts: each opted-in project once per workspace
  // day, on one instance at a time. Minute 43 is free.
  jobs.push(
    new Cron(
      "43 * * * *",
      withCheckIn("flow-alerts", () => runFlowAlerts()),
    ),
  );
  // Trash older than TRASH_RETENTION_DAYS, on one instance at a time (C7).
  jobs.push(
    new Cron(
      "29 * * * *",
      withCheckIn("trash-purge", () => runTrashPurge()),
    ),
  );
  // Workspaces whose deletion grace period is over, on one instance at a
  // time. Minute 31 is free.
  jobs.push(
    new Cron(
      "31 * * * *",
      withCheckIn("workspace-deletion-purge", () =>
        runWorkspaceDeletionPurge(),
      ),
    ),
  );
  // Uploads never finalized within a day (S3 or the local store), on one
  // instance at a time.
  jobs.push(
    new Cron(
      "35 * * * *",
      withCheckIn("storage-upload-sweep", () => sweepAbandonedUploads()),
    ),
  );
  // Full-text search rows the boot backfill has not reached (a crash, or a
  // lease held by another instance). Minute 49 is free.
  jobs.push(
    new Cron(
      "49 * * * *",
      withCheckIn("search-index-backfill", () => runSearchIndexBackfill()),
    ),
  );
  // Optional semantic search (D1): embeds new and changed tasks, pages and
  // comments of workspaces that use it, under a job lease. Without AI or
  // a workspace using it each pass is a settings read. Offset from the
  // 5-minute jobs.
  jobs.push(
    new Cron(
      "2-59/5 * * * *",
      withCheckIn("ai-embedding-index", () => runEmbeddingIndexer()),
    ),
  );
  console.log(
    "⏰ Scheduler started (snoozed notifications, batched notification emails, export recovery and the webhook sweep every minute, reminders and intake snooze wake-ups every 5 minutes, notification digests and scheduled repeating tasks every 15 minutes, seat reconciliation, trial reminders, project automations, cycle rollover, flow alerts, export cleanup, webhook retention, audit log, instance audit and API request log retention, the trash purge, the workspace deletion purge, the abandoned-upload sweep and the search index backfill hourly)",
  );
}

export function shutdownScheduler(): void {
  // Running agent runs finish; nothing new is claimed.
  enableAgentRunner(false);
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
}
