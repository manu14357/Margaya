import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceWebhookTable } from "../../database/schema";
import { WEBHOOK_NOT_FOUND, type WebhookRow } from "../access";
import { toWebhookResponse } from "../serialize";
import { generateWebhookSecret, sealedWebhookSecret } from "./shared";

const HOUR_MS = 60 * 60 * 1000;

/**
 * A new secret, shown once. With a grace period the outgoing secret stays
 * valid until then and both signatures are sent; a second rotation inside
 * the grace period replaces the previous secret with the one rotated out.
 */
export async function rotateWebhookSecret(
  webhook: WebhookRow,
  graceHours: number,
) {
  const secret = generateWebhookSecret();
  const now = new Date();
  const keepPrevious = graceHours > 0;
  const [updated] = await db
    .update(workspaceWebhookTable)
    .set({
      ...sealedWebhookSecret(secret),
      previousSecretCiphertext: keepPrevious ? webhook.secretCiphertext : null,
      previousSecretExpiresAt: keepPrevious
        ? new Date(now.getTime() + graceHours * HOUR_MS)
        : null,
      secretRotatedAt: now,
    })
    .where(eq(workspaceWebhookTable.id, webhook.id))
    .returning();
  if (!updated) throw new HTTPException(404, { message: WEBHOOK_NOT_FOUND });
  return { ...(await toWebhookResponse(updated, now)), secret };
}
