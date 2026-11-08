import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pushSubscriptionTable } from "../database/schema";
import { assertPublicDestination } from "../utils/assert-public-destination";
import {
  OutboundRequestError,
  safeOutboundError,
  sendOutboundRequest,
} from "../utils/outbound-request";
import {
  buildPushRequest,
  getVapidConfig,
  type PushKeys,
  type PushUrgency,
} from "./web-push";

// Each device costs one outbound request per notification, so one account
// can't grow this without limit. The oldest device makes way for a new one.
const MAX_DEVICES_PER_USER = 10;
const MAX_USER_AGENT_LENGTH = 512;

export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export async function getPushStatus(userId: string) {
  const vapid = getVapidConfig();
  if (!vapid) {
    return { available: false, publicKey: null, subscriptions: [] };
  }
  const subscriptions = await db
    .select({
      id: pushSubscriptionTable.id,
      endpoint: pushSubscriptionTable.endpoint,
      userAgent: pushSubscriptionTable.userAgent,
      createdAt: pushSubscriptionTable.createdAt,
    })
    .from(pushSubscriptionTable)
    .where(
      and(
        eq(pushSubscriptionTable.userId, userId),
        eq(pushSubscriptionTable.vapidPublicKey, vapid.publicKey),
      ),
    )
    .orderBy(desc(pushSubscriptionTable.createdAt));
  return { available: true, publicKey: vapid.publicKey, subscriptions };
}

async function removeOldestDevices(userId: string) {
  const extra = await db
    .select({ id: pushSubscriptionTable.id })
    .from(pushSubscriptionTable)
    .where(eq(pushSubscriptionTable.userId, userId))
    .orderBy(desc(pushSubscriptionTable.updatedAt))
    .offset(MAX_DEVICES_PER_USER);
  if (extra.length > 0) {
    await db.delete(pushSubscriptionTable).where(
      inArray(
        pushSubscriptionTable.id,
        extra.map((row) => row.id),
      ),
    );
  }
}

export async function savePushSubscription(
  userId: string,
  input: { endpoint: string; keys: PushKeys },
  userAgent: string | undefined,
) {
  const vapid = getVapidConfig();
  if (!vapid) {
    throw new HTTPException(409, {
      message: "Push notifications are not set up on this server",
    });
  }
  try {
    await assertPublicDestination(input.endpoint, "Push");
  } catch {
    throw new HTTPException(400, { message: "Invalid push endpoint" });
  }

  const values = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    vapidPublicKey: vapid.publicKey,
    userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
  };
  await db
    .insert(pushSubscriptionTable)
    .values({ ...values, endpoint: input.endpoint })
    .onConflictDoUpdate({
      target: pushSubscriptionTable.endpoint,
      set: { ...values, updatedAt: new Date() },
    });
  await removeOldestDevices(userId);

  return getPushStatus(userId);
}

export async function deletePushSubscription(userId: string, id: string) {
  const removed = await db
    .delete(pushSubscriptionTable)
    .where(
      and(
        eq(pushSubscriptionTable.id, id),
        eq(pushSubscriptionTable.userId, userId),
      ),
    )
    .returning({ id: pushSubscriptionTable.id });
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Device not found" });
  }
  return getPushStatus(userId);
}

function isGone(error: unknown) {
  return (
    error instanceof OutboundRequestError &&
    (error.status === 404 || error.status === 410)
  );
}

/**
 * Sends one message to every device of a user and removes the ones the push
 * service says are gone. Never rejects: a failed push must not affect the other
 * channels. Endpoints stay out of the logs because they address a device.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage,
  urgency: PushUrgency,
): Promise<void> {
  const vapid = getVapidConfig();
  if (!vapid) return;

  try {
    const subscriptions = await db
      .select()
      .from(pushSubscriptionTable)
      .where(eq(pushSubscriptionTable.userId, userId));
    const payload = JSON.stringify(message);

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const remove = () =>
          db
            .delete(pushSubscriptionTable)
            .where(eq(pushSubscriptionTable.id, subscription.id));

        if (subscription.vapidPublicKey !== vapid.publicKey) {
          await remove();
          return;
        }
        try {
          await sendOutboundRequest(
            subscription.endpoint,
            buildPushRequest({
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              payload,
              urgency,
              vapid,
            }),
            { publicDestination: true, timeoutMs: 15_000 },
          );
        } catch (error) {
          if (isGone(error)) {
            await remove();
            return;
          }
          console.error("Push delivery failed", {
            subscriptionId: subscription.id,
            error: safeOutboundError(error),
          });
        }
      }),
    );
  } catch (error) {
    console.error("Push delivery failed", {
      userId,
      error: safeOutboundError(error),
    });
  }
}
