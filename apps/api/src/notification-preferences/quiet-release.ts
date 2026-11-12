import { emailCopy, plural, resolveEmailLocale } from "@margaya/email";
import { eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import db from "../database";
import {
  notificationDeliveryHoldTable,
  userNotificationPreferenceTable,
  userTable,
} from "../database/schema";
import { publishEvent } from "../events";
import {
  isQuietNow,
  quietSettings,
  validTimeZone,
} from "../notification/quiet";
import { enqueueNotificationEmail } from "../notification-email/queue";
import { cleanPreferences } from "../user/controllers/user-preferences";
import { safeOutboundError } from "../utils/outbound-request";
import {
  deliverNotification,
  sendGotifyNotification,
  sendNtfyNotification,
} from "./delivery";
import { sendPushToUser } from "./push";
import { decryptSecret } from "./secrets";

// When a user's quiet hours or focus mode end, what was held goes out:
// email as one batched email (through the email queue, which checks each
// notification again), one summary on push, ntfy and Gotify, each held
// payload on the webhook, and a hint that lets Margaya Desktop show one
// summary alert. The inbox already holds every notification.

const hold = notificationDeliveryHoldTable;

// A claim older than this belongs to a run that crashed; it is retried.
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_USERS_PER_RUN = 200;
// Where a summary opens the app: its start page, which leads to the inbox.
const SUMMARY_PATH = "/dashboard";
const SUMMARY_TAG = "margaya-quiet-summary";

// Until `pnpm i18n:emails` picks up `emails.quietSummary`, English.
const ENGLISH_SUMMARY = {
  title: "Notifications are back on",
  body_one: "{{count}} notification arrived while they were paused.",
  body_other: "{{count}} notifications arrived while they were paused.",
};

export function quietSummaryText(
  locale: string | null | undefined,
  count: number,
): { title: string; body: string } {
  const copy =
    (emailCopy(locale) as unknown as { quietSummary?: typeof ENGLISH_SUMMARY })
      .quietSummary ?? ENGLISH_SUMMARY;
  return {
    title: copy.title,
    body: plural(copy, "body", resolveEmailLocale(locale), count),
  };
}

type HeldRow = {
  id: string;
  notification_id: string;
  channels: string[];
  created_at: Date | string;
};

type ReleaseUser = {
  id: string;
  locale: string | null;
  banned: boolean | null;
  banExpires: Date | null;
};

async function sendSummaries(user: ReleaseUser, rows: HeldRow[]) {
  const count = (channel: string) =>
    rows.filter((row) => row.channels.includes(channel)).length;
  const ids = (channel: string) =>
    rows
      .filter((row) => row.channels.includes(channel))
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      .map((row) => row.notification_id);
  const sends: Array<Promise<unknown>> = [];

  for (const notificationId of ids("email")) {
    sends.push(enqueueNotificationEmail(notificationId, user.id));
  }

  const isBanned =
    user.banned === true && (!user.banExpires || user.banExpires > new Date());
  const pushCount = count("push");
  if (pushCount > 0 && !isBanned) {
    const text = quietSummaryText(user.locale, pushCount);
    sends.push(
      sendPushToUser(
        user.id,
        { ...text, url: SUMMARY_PATH, tag: SUMMARY_TAG },
        "normal",
      ),
    );
  }

  const ntfyCount = count("ntfy");
  const gotifyCount = count("gotify");
  if (ntfyCount > 0 || gotifyCount > 0) {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      { where: eq(userNotificationPreferenceTable.userId, user.id) },
    );
    if (
      ntfyCount > 0 &&
      preference?.ntfyEnabled &&
      preference.ntfyServerUrl &&
      preference.ntfyTopic
    ) {
      const text = quietSummaryText(user.locale, ntfyCount);
      sends.push(
        sendNtfyNotification({
          serverUrl: preference.ntfyServerUrl,
          topic: preference.ntfyTopic,
          token: decryptSecret(preference.ntfyToken),
          ...text,
        }),
      );
    }
    const gotifyToken = decryptSecret(preference?.gotifyToken ?? null);
    if (
      gotifyCount > 0 &&
      preference?.gotifyEnabled &&
      preference.gotifyServerUrl &&
      gotifyToken
    ) {
      const text = quietSummaryText(user.locale, gotifyCount);
      sends.push(
        sendGotifyNotification({
          serverUrl: preference.gotifyServerUrl,
          token: gotifyToken,
          ...text,
        }),
      );
    }
  }

  // Webhooks are machine payloads: each held one goes out, oldest first,
  // checked again like a fresh delivery.
  const webhooks = ids("webhook");
  if (webhooks.length > 0) {
    sends.push(
      (async () => {
        for (const notificationId of webhooks) {
          await deliverNotification(notificationId, { only: ["webhook"] });
        }
      })(),
    );
  }

  const desktopCount = count("desktop");
  if (desktopCount > 0) {
    sends.push(
      publishEvent("notification.deliveries_released", {
        userId: user.id,
        count: desktopCount,
      }),
    );
  }

  const results = await Promise.allSettled(sends);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Quiet-time summary failed", {
        userId: user.id,
        error: safeOutboundError(result.reason),
      });
    }
  }
}

/** Claims the user's held rows, sends the summaries and deletes the rows. */
async function releaseUser(user: ReleaseUser, now: Date, staleClaim: Date) {
  // SKIP LOCKED plus the claim keep two instances off the same rows.
  const claimed = await db.execute<HeldRow>(sql`
    update notification_delivery_hold as h
    set claimed_at = ${now}
    where h.id in (
      select pending.id from notification_delivery_hold as pending
      where pending.user_id = ${user.id}
        and (pending.claimed_at is null or pending.claimed_at < ${staleClaim})
      for update skip locked
    )
    returning h.id, h.notification_id, h.channels, h.created_at
  `);
  if (claimed.rows.length === 0) return 0;
  await sendSummaries(user, claimed.rows);
  await db.delete(hold).where(
    inArray(
      hold.id,
      claimed.rows.map((row) => row.id),
    ),
  );
  return claimed.rows.length;
}

export type ReleaseOutcome = { released: number; degraded: boolean };

/**
 * The scheduler job (every minute, safe on every instance): releases what
 * quiet time held for each user whose quiet hours and focus have ended.
 */
export async function releaseHeldDeliveries(
  now: Date = new Date(),
): Promise<ReleaseOutcome> {
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const pending = await db
    .selectDistinct({ userId: hold.userId })
    .from(hold)
    .where(or(isNull(hold.claimedAt), lt(hold.claimedAt, staleClaim)))
    .limit(MAX_USERS_PER_RUN);
  if (pending.length === 0) return { released: 0, degraded: false };

  const users = await db
    .select({
      id: userTable.id,
      locale: userTable.locale,
      banned: userTable.banned,
      banExpires: userTable.banExpires,
      preferences: userTable.preferences,
      timezone: userTable.timezone,
    })
    .from(userTable)
    .where(
      inArray(
        userTable.id,
        pending.map((row) => row.userId),
      ),
    );

  let released = 0;
  let degraded = false;
  for (const user of users) {
    const settings = quietSettings(cleanPreferences(user.preferences));
    if (isQuietNow(settings, now, validTimeZone(user.timezone))) continue;
    try {
      released += await releaseUser(user, now, staleClaim);
    } catch (error) {
      degraded = true;
      console.error("Failed to release held notifications", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { released, degraded };
}
