import {
  sendNotificationBatchEmail,
  sendNotificationEmail,
} from "@margaya/email";
import { inArray, isNull, lt, or, sql } from "drizzle-orm";
import db from "../database";
import { notificationEmailQueueTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { batchDueBefore, getEmailBatchWindowSeconds } from "./batch-window";
import { type BatchRecipient, loadEligibleBatchItems } from "./eligible-items";
import { type BatchItem, batchSubject, groupBatchItems } from "./grouping";
import { notificationSettingsUrl } from "./links";

export const NOTIFICATION_EMAIL_FLUSH_LEASE = "notification-email-flush";

// Shorter than the one-minute schedule, so a crashed holder never skips
// more than one run.
const LEASE_MS = 50 * 1000;
// A claim older than this belongs to a sender that crashed or failed; its
// rows are tried again. It also spaces out retries while SMTP is failing.
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_USERS_PER_RUN = 200;
// Rows that could not be sent for this long are given up on.
const ABANDON_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const queue = notificationEmailQueueTable;

export type FlushOutcome = { emails: number; degraded: boolean };

async function sendBatch(recipient: BatchRecipient, items: BatchItem[]) {
  const [only] = items;
  if (items.length === 1 && only) {
    // A batch of one looks exactly like an unbatched email.
    await sendNotificationEmail(recipient.email, only.title, {
      title: only.title,
      message: only.body,
      actionUrl: only.task?.url ?? null,
      actionLabel: only.task ? "Open in Margaya" : undefined,
      locale: recipient.locale,
    });
    return;
  }
  const groups = groupBatchItems(items);
  await sendNotificationBatchEmail(recipient.email, batchSubject(groups), {
    groups,
    settingsUrl: notificationSettingsUrl(),
    locale: recipient.locale,
  });
}

/**
 * Claims every claimable queued row of one user, sends what still passes
 * the checks as one email and deletes the rows. A failed send keeps the
 * claim, so the rows are retried once it goes stale.
 */
async function flushUser(userId: string, now: Date, staleClaim: Date) {
  // SKIP LOCKED plus the claim timestamp keep two senders off the same rows.
  const claimed = await db.execute<{ id: string; notification_id: string }>(sql`
    update notification_email_queue as q
    set claimed_at = ${now}
    where q.id in (
      select pending.id from notification_email_queue as pending
      where pending.user_id = ${userId}
        and (pending.claimed_at is null or pending.claimed_at < ${staleClaim})
      for update skip locked
    )
    returning q.id, q.notification_id
  `);
  if (claimed.rows.length === 0) return 0;

  const { recipient, items } = await loadEligibleBatchItems(
    userId,
    claimed.rows.map((row) => row.notification_id),
  );
  if (recipient && items.length > 0) {
    await sendBatch(recipient, items);
  }
  await db.delete(queue).where(
    inArray(
      queue.id,
      claimed.rows.map((row) => row.id),
    ),
  );
  return recipient && items.length > 0 ? 1 : 0;
}

async function runFlush(now: Date): Promise<FlushOutcome> {
  const dueBefore = batchDueBefore(now, getEmailBatchWindowSeconds());
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  // Users whose oldest claimable row has waited a full window.
  const due = await db
    .select({ userId: queue.userId })
    .from(queue)
    .where(or(isNull(queue.claimedAt), lt(queue.claimedAt, staleClaim)))
    .groupBy(queue.userId)
    .having(sql`min(${queue.createdAt}) <= ${dueBefore}`)
    .limit(MAX_USERS_PER_RUN);

  let emails = 0;
  let degraded = false;
  for (const { userId } of due) {
    try {
      emails += await flushUser(userId, now, staleClaim);
    } catch (error) {
      degraded = true;
      console.error("Failed to send batched notification email", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await db
    .delete(queue)
    .where(lt(queue.createdAt, new Date(now.getTime() - ABANDON_AFTER_MS)));

  return { emails, degraded };
}

/** The scheduler job: sends every batch whose window has passed. */
export async function flushNotificationEmails(
  now: Date = new Date(),
): Promise<FlushOutcome> {
  return withJobLease(
    NOTIFICATION_EMAIL_FLUSH_LEASE,
    () => runFlush(now),
    () => ({ emails: 0, degraded: false }),
    LEASE_MS,
  );
}
