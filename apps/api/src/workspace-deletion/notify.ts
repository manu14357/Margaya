import { sendNotificationEmail } from "@margaya/email";
import { eq } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceUserTable } from "../database/schema";
import { subscribeToEvent } from "../events";

// Emails every member when their workspace is scheduled for deletion, and
// again when the deletion is cancelled. Best effort: failures are logged,
// and without SMTP nothing is sent.

type DeletionEvent = {
  workspaceId?: string;
  workspaceName?: string;
  dueAt?: string | null;
};

function clientUrl(): string {
  return (process.env.MARGAYA_CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "soon";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "soon"
    : date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
}

async function membersOf(workspaceId: string) {
  return db
    .select({ email: userTable.email, locale: userTable.locale })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
}

async function emailMembers(
  workspaceId: string,
  subject: string,
  title: string,
  message: string,
) {
  const members = await membersOf(workspaceId);
  for (const member of members) {
    if (!member.email) continue;
    try {
      await sendNotificationEmail(member.email, subject, {
        title,
        message,
        actionUrl: `${clientUrl()}/dashboard/workspace/${workspaceId}`,
        actionLabel: "Open workspace",
        locale: member.locale ?? null,
      });
    } catch {
      console.error(
        `workspace deletion: could not email a member of ${workspaceId}`,
      );
    }
  }
}

void subscribeToEvent<DeletionEvent>(
  "workspace.deletion_scheduled",
  async (data) => {
    if (!data?.workspaceId) return;
    const name = data.workspaceName || "A workspace";
    const date = formatDate(data.dueAt);
    await emailMembers(
      data.workspaceId,
      `${name} is scheduled for deletion`,
      `${name} will be deleted on ${date}`,
      `The owner scheduled this workspace for deletion. Until ${date} it is read-only: you can still open and export its work, and the owner can cancel the deletion. After that date its projects, tasks and pages are deleted for good.`,
    );
  },
);

void subscribeToEvent<DeletionEvent>(
  "workspace.deletion_cancelled",
  async (data) => {
    if (!data?.workspaceId) return;
    const name = data.workspaceName || "A workspace";
    await emailMembers(
      data.workspaceId,
      `${name} will not be deleted`,
      `${name} is back`,
      "The owner cancelled the scheduled deletion. The workspace is no longer read-only, and its API keys and webhooks work again.",
    );
  },
);
