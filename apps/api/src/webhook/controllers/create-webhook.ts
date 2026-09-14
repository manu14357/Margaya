import { count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workspaceTable, workspaceWebhookTable } from "../../database/schema";
import type { CreateWebhookInput } from "../schema";
import { toWebhookResponse } from "../serialize";
import { MAX_WEBHOOKS_PER_WORKSPACE } from "../types";
import { assertWebhookUrlAllowed } from "../url";
import {
  generateWebhookSecret,
  isUniqueViolation,
  normalizeWebhookName,
  sealedWebhookSecret,
  WEBHOOK_URL_TAKEN,
  webhookPatterns,
} from "./shared";

export const WEBHOOK_LIMIT_REACHED = `This workspace already has ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks`;

type WebhookRow = typeof workspaceWebhookTable.$inferSelect;

/** Registers a webhook; the response carries its secret, shown once. */
export async function createWebhook(
  input: CreateWebhookInput & { userId: string },
) {
  const events = webhookPatterns(input.events);
  const url = await assertWebhookUrlAllowed(input.url);
  const secret = generateWebhookSecret();

  let row: WebhookRow | undefined;
  try {
    row = await db.transaction(async (tx) => {
      // Serializes creates per workspace, so the limit holds under races.
      await tx
        .select({ id: workspaceTable.id })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, input.workspaceId))
        .for("update");
      const [existing] = await tx
        .select({ total: count() })
        .from(workspaceWebhookTable)
        .where(eq(workspaceWebhookTable.workspaceId, input.workspaceId));
      if ((existing?.total ?? 0) >= MAX_WEBHOOKS_PER_WORKSPACE) {
        throw new HTTPException(409, { message: WEBHOOK_LIMIT_REACHED });
      }
      const [created] = await tx
        .insert(workspaceWebhookTable)
        .values({
          workspaceId: input.workspaceId,
          name: normalizeWebhookName(input.name),
          url,
          events,
          isActive: input.isActive,
          disabledReason: input.isActive ? null : "manual",
          disabledAt: input.isActive ? null : new Date(),
          ...sealedWebhookSecret(secret),
          createdBy: input.userId,
        })
        .returning();
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HTTPException(409, { message: WEBHOOK_URL_TAKEN });
    }
    throw error;
  }
  if (!row) {
    throw new HTTPException(500, { message: "Failed to create webhook" });
  }
  return { ...(await toWebhookResponse(row)), secret };
}
