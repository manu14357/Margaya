import { sendNotificationEmail } from "@margaya/email";
import { eq } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceUserTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import {
  type DeletionEmailCopy,
  workspaceDeletionEmailCopy,
} from "./email-copy";

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

async function membersOf(workspaceId: string) {
  return db
    .select({ email: userTable.email, locale: userTable.locale })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
}

type MemberEmail = { subject: string; title: string; message: string };

async function emailMembers(
  workspaceId: string,
  dueAt: string | null | undefined,
  build: (copy: DeletionEmailCopy, date: string | null) => MemberEmail,
) {
  const members = await membersOf(workspaceId);
  for (const member of members) {
    if (!member.email) continue;
    const { copy, date } = workspaceDeletionEmailCopy(member.locale, dueAt);
    const { subject, title, message } = build(copy, date);
    try {
      await sendNotificationEmail(member.email, subject, {
        title,
        message,
        actionUrl: `${clientUrl()}/dashboard/workspace/${workspaceId}`,
        actionLabel: copy.openWorkspace,
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
    await emailMembers(data.workspaceId, data.dueAt, (copy, date) => {
      const name = data.workspaceName || copy.fallbackName;
      return {
        subject: copy.scheduledSubject(name),
        title: copy.scheduledTitle(name, date),
        message: copy.scheduledMessage(date),
      };
    });
  },
);

void subscribeToEvent<DeletionEvent>(
  "workspace.deletion_cancelled",
  async (data) => {
    if (!data?.workspaceId) return;
    await emailMembers(data.workspaceId, null, (copy) => {
      const name = data.workspaceName || copy.fallbackName;
      return {
        subject: copy.cancelledSubject(name),
        title: copy.cancelledTitle(name),
        message: copy.cancelledMessage,
      };
    });
  },
);
