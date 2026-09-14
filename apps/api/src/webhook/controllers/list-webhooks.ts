import { desc, eq } from "drizzle-orm";
import db from "../../database";
import { workspaceWebhookTable } from "../../database/schema";
import { toWebhookResponses } from "../serialize";
import { MAX_WEBHOOKS_PER_WORKSPACE } from "../types";

/** The workspace's webhooks, newest first. */
export async function listWebhooks(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceWebhookTable)
    .where(eq(workspaceWebhookTable.workspaceId, workspaceId))
    .orderBy(
      desc(workspaceWebhookTable.createdAt),
      desc(workspaceWebhookTable.id),
    )
    .limit(MAX_WEBHOOKS_PER_WORKSPACE);
  return toWebhookResponses(rows);
}
