import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { workspaceWebhookTable } from "../database/schema";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

export const WEBHOOK_NOT_FOUND = "Webhook not found";

export type WebhookRow = typeof workspaceWebhookTable.$inferSelect;

/**
 * Loads the webhook in the path (404 when missing), checks workspace access
 * and sets `workspaceId` and `webhook`. Reads the raw path param: route
 * middleware runs before the validators.
 */
export function webhookAccess(idKey = "id") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

    const webhookId = c.req.param(idKey);
    const [webhook] = webhookId
      ? await db
          .select()
          .from(workspaceWebhookTable)
          .where(eq(workspaceWebhookTable.id, webhookId))
          .limit(1)
      : [];
    if (!webhook) throw new HTTPException(404, { message: WEBHOOK_NOT_FOUND });

    await validateWorkspaceAccess(
      userId,
      webhook.workspaceId,
      c.get("apiKey")?.id,
    );
    c.set("workspaceId", webhook.workspaceId);
    c.set("webhook", webhook);
    return next();
  };
}
