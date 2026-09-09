import { sendNotificationDigestEmail } from "@margaya/email";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import db from "../database";
import { userNotificationPreferenceTable, userTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { getUserTimezone } from "../utils/timezone";
import { buildDigestWorkspaces } from "./digest-content";
import { digestSince, isDigestDue } from "./digest-schedule";
import { notificationSettingsUrl } from "./links";

export const NOTIFICATION_DIGEST_LEASE = "notification-digest";

// The job runs every 15 minutes; a crashed holder skips at most one run.
const LEASE_MS = 14 * 60 * 1000;

const preference = userNotificationPreferenceTable;

export type DigestOutcome = { sent: number; degraded: boolean };

const SUBJECTS = {
  daily: "Your Margaya daily digest",
  weekly: "Your Margaya weekly digest",
} as const;

/**
 * Stamps the period as handled, only if no one else did since we read it.
 * The stamp comes first so a second instance or a slow run never sends the
 * same period twice.
 */
async function claimPeriod(userId: string, previous: Date | null, now: Date) {
  const claimed = await db
    .update(preference)
    .set({ lastDigestSentAt: now })
    .where(
      and(
        eq(preference.userId, userId),
        sql`${preference.lastDigestSentAt} is not distinct from ${previous}`,
      ),
    )
    .returning({ id: preference.id });
  return claimed.length > 0;
}

async function releasePeriod(userId: string, previous: Date | null, now: Date) {
  await db
    .update(preference)
    .set({ lastDigestSentAt: previous })
    .where(
      and(eq(preference.userId, userId), eq(preference.lastDigestSentAt, now)),
    );
}

type Candidate = {
  userId: string;
  email: string;
  locale: string | null;
  frequency: string;
  weekday: number;
  hour: number;
  lastSentAt: Date | null;
};

/** Sends one user's digest if it is due; true when an email went out. */
export async function sendDigestIfDue(
  candidate: Candidate,
  now: Date,
): Promise<boolean> {
  if (candidate.frequency !== "daily" && candidate.frequency !== "weekly") {
    return false;
  }
  const frequency = candidate.frequency;
  const timeZone = await getUserTimezone(candidate.userId);
  const due = isDigestDue(
    {
      frequency,
      weekday: candidate.weekday,
      hour: candidate.hour,
      timeZone,
      lastSentAt: candidate.lastSentAt,
    },
    now,
  );
  if (!due) return false;
  if (!(await claimPeriod(candidate.userId, candidate.lastSentAt, now))) {
    return false;
  }

  try {
    const workspaces = await buildDigestWorkspaces({
      userId: candidate.userId,
      since: digestSince(frequency, candidate.lastSentAt, now),
      now,
      timeZone,
      locale: candidate.locale,
    });
    // An empty period stays stamped: nothing in it can still be reported.
    if (workspaces.length === 0) return false;
    const result = await sendNotificationDigestEmail(
      candidate.email,
      SUBJECTS[frequency],
      {
        frequency,
        workspaces,
        settingsUrl: notificationSettingsUrl(),
        locale: candidate.locale,
      },
    );
    return result.success;
  } catch (error) {
    await releasePeriod(candidate.userId, candidate.lastSentAt, now);
    throw error;
  }
}

async function runDigests(now: Date): Promise<DigestOutcome> {
  const candidates = await db
    .select({
      userId: preference.userId,
      email: userTable.email,
      locale: userTable.locale,
      frequency: preference.digestFrequency,
      weekday: preference.digestWeekday,
      hour: preference.digestHour,
      lastSentAt: preference.lastDigestSentAt,
    })
    .from(preference)
    .innerJoin(userTable, eq(userTable.id, preference.userId))
    .where(
      and(
        inArray(preference.digestFrequency, ["daily", "weekly"]),
        isNotNull(userTable.email),
      ),
    );

  let sent = 0;
  let degraded = false;
  for (const candidate of candidates) {
    if (!candidate.email) continue;
    try {
      if (
        await sendDigestIfDue(
          {
            ...candidate,
            email: candidate.email,
            locale: candidate.locale ?? null,
          },
          now,
        )
      ) {
        sent += 1;
      }
    } catch (error) {
      degraded = true;
      console.error("Failed to send notification digest", {
        userId: candidate.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent, degraded };
}

/** The scheduler job: sends every digest whose local send time has come. */
export async function sendNotificationDigests(
  now: Date = new Date(),
): Promise<DigestOutcome> {
  return withJobLease(
    NOTIFICATION_DIGEST_LEASE,
    () => runDigests(now),
    () => ({ sent: 0, degraded: false }),
    LEASE_MS,
  );
}
