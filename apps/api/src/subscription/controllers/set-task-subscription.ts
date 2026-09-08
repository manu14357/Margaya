import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  getSubscriptionState,
  muteUser,
  type SubscriptionState,
  subscribeUsers,
} from "../service";

/**
 * Subscribes or unsubscribes the caller. Idempotent: an event is published
 * only when the effective state changed.
 */
async function setTaskSubscription(
  taskId: string,
  userId: string,
  subscribed: boolean,
): Promise<SubscriptionState> {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });

  const before = await getSubscriptionState(taskId, userId);
  if (subscribed) {
    await subscribeUsers(taskId, [userId], "manual");
  } else {
    await muteUser(taskId, userId);
  }
  const after = await getSubscriptionState(taskId, userId);

  if (before.subscribed !== after.subscribed) {
    await publishEvent("task.subscription_changed", {
      taskId,
      projectId: task.projectId,
      userId,
      subscribed: after.subscribed,
      reason: after.reason,
    });
  }
  return after;
}

export default setTaskSubscription;
