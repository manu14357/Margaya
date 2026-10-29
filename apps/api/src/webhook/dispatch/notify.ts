import { emailCopy, fill, sendNotificationEmail } from "@margaya/email";
import { eq } from "drizzle-orm";
import db from "../../database";
import { userTable, workspaceWebhookTable } from "../../database/schema";

// The best-effort email to a webhook's creator after Margaya disabled it
// (K11). Failures are logged and swallowed; without SMTP nothing is sent.

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export function webhookDetailUrl(webhookId: string): string {
  const clientUrl = (
    process.env.MARGAYA_CLIENT_URL || "http://localhost:5173"
  ).replace(/\/+$/, "");
  return `${clientUrl}/dashboard/settings/workspace/webhooks/${webhookId}`;
}

export async function notifyWebhookDisabled(webhookId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        url: workspaceWebhookTable.url,
        email: userTable.email,
        locale: userTable.locale,
      })
      .from(workspaceWebhookTable)
      .innerJoin(userTable, eq(userTable.id, workspaceWebhookTable.createdBy))
      .where(eq(workspaceWebhookTable.id, webhookId))
      .limit(1);
    if (!row?.email) return;
    const copy = emailCopy(row.locale).webhookDisabled;
    const host = hostOf(row.url);
    await sendNotificationEmail(row.email, copy.subject, {
      title: copy.title,
      message: host ? fill(copy.message, { host }) : copy.messageNoHost,
      actionUrl: webhookDetailUrl(webhookId),
      actionLabel: copy.actionLabel,
      locale: row.locale ?? null,
    });
  } catch {
    console.error(`webhooks: could not email about disabled ${webhookId}`);
  }
}
