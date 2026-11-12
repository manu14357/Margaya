import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  intakeEmailMessageTable,
  intakeEmailSettingsTable,
  intakeItemTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { MAX_INTAKE_DESCRIPTION, MAX_INTAKE_TITLE } from "../intake/schema";
import { submitIntakeItem } from "../intake/service";
import { notifyTaskEvent } from "../notification/recipients";
import { stripPublicMarkup } from "../public-board/sanitize";
import { plainTextPreview } from "../utils/plain-text-preview";
import { createRateLimiter } from "../utils/rate-limit";
import {
  type SkippedAttachment,
  type StoredAttachment,
  storeEmailAttachments,
} from "./attachments";
import { intakeBaseAddress, intakeEmailLimits, ownAddresses } from "./config";
import {
  type IgnoreReason,
  isSpam,
  loopReason,
  type MailHeaders,
  recipientTokens,
  senderDomainReason,
} from "./filters";
import {
  type MailAddress,
  type MailAttachment,
  mailBodyText,
  normalizeAddress,
  type ParsedMail,
  parseAddressList,
  stripQuotedReply,
} from "./mime";

// Turns one inbound message into a request or a comment (#8). Both
// receiving modes (IMAP polling and the inbound webhook) end here, so the
// abuse checks hold for both.

export type InboundMail = {
  from: MailAddress | null;
  /** Every address it was delivered to (To, Cc, Delivered-To, envelope). */
  recipients: string[];
  subject: string;
  messageId: string | null;
  /** In-Reply-To then References. */
  threadIds: string[];
  text: string;
  headers: MailHeaders;
  contentType: string;
  attachments: MailAttachment[];
  /** A provider's spam score, when the webhook sends one. */
  spamScore?: number | null;
  size: number;
};

export type InboundOutcome =
  | { status: "created"; projectId: string; intakeItemId: string }
  | { status: "commented"; projectId: string; intakeItemId: string }
  | { status: "ignored"; projectId: string | null; reason: IgnoreReason };

export type InboundRoute =
  | { kind: "instance" }
  | { kind: "project"; projectId: string };

// Per project, so one noisy sender or flood can't fill a queue.
const SENDER_HOURLY = createRateLimiter({
  name: "intake-email-sender",
  windowSeconds: 60 * 60,
  max: 10,
});
const PROJECT_HOURLY = createRateLimiter({
  name: "intake-email-project",
  windowSeconds: 60 * 60,
  max: 200,
});

const DELIVERY_HEADERS = [
  "delivered-to",
  "x-original-to",
  "envelope-to",
  "x-forwarded-to",
];

/** An `InboundMail` from a parsed raw message. */
export function inboundFromParsed(
  parsed: ParsedMail,
  size: number,
  extraRecipients: readonly string[] = [],
): InboundMail {
  const recipients = new Set<string>();
  for (const address of [...parsed.to, ...parsed.cc]) {
    recipients.add(address.address);
  }
  for (const name of DELIVERY_HEADERS) {
    for (const value of parsed.headers.get(name) ?? []) {
      for (const address of parseAddressList(value)) {
        recipients.add(address.address);
      }
    }
  }
  for (const value of extraRecipients) {
    const address = normalizeAddress(value);
    if (address) recipients.add(address);
  }
  return {
    from: parsed.from,
    recipients: [...recipients],
    subject: parsed.subject,
    messageId: parsed.messageId,
    threadIds: [...parsed.inReplyTo, ...parsed.references],
    text: mailBodyText(parsed),
    headers: parsed.headers,
    contentType: parsed.contentType,
    attachments: parsed.attachments,
    size,
  };
}

/** The id a message is remembered by; a hash when it has no Message-ID. */
export function messageKey(mail: InboundMail): string {
  if (mail.messageId) return mail.messageId.toLowerCase();
  const hash = createHash("sha256")
    .update(
      [
        mail.from?.address ?? "",
        mail.subject,
        mail.headers.get("date")?.[0] ?? "",
        mail.text.slice(0, 4000),
      ].join("\n"),
    )
    .digest("hex");
  return `sha256:${hash}`;
}

const REPLY_PREFIX =
  /^\s*((re|fwd?|aw|wg|sv|vs|tr|rv|enc)\s*(\[\d+\])?\s*:\s*)+/i;

/** A request title from a subject: one line, prefixes off, bounded. */
export function titleFromSubject(subject: string, sender: string): string {
  const title = stripPublicMarkup(subject)
    .replace(REPLY_PREFIX, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.min(255, MAX_INTAKE_TITLE));
  return title || `Email from ${sender}`.slice(0, 255);
}

function skippedNote(skipped: readonly SkippedAttachment[]): string {
  if (skipped.length === 0) return "";
  const names = skipped.map((file) => `- ${file.filename} (${file.reason})`);
  return `\n\n---\nAttachments not kept:\n${names.join("\n")}`;
}

/** The request description: the body as plain markdown, bounded. */
export function descriptionFromBody(text: string): string {
  return stripPublicMarkup(text).slice(0, MAX_INTAKE_DESCRIPTION - 2_000);
}

type Target = {
  projectId: string;
  workspaceId: string;
  allowedDomains: string[];
  blockedDomains: string[];
};

async function targetsFor(route: InboundRoute, mail: InboundMail) {
  const base = intakeBaseAddress();
  const tokens =
    route.kind === "instance" && base
      ? recipientTokens(mail.recipients, base)
      : [];
  if (route.kind === "instance" && tokens.length === 0) return [];
  return db
    .select({
      projectId: intakeEmailSettingsTable.projectId,
      workspaceId: projectTable.workspaceId,
      enabled: intakeEmailSettingsTable.enabled,
      intakeEnabled: projectTable.intakeEnabled,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
      allowedDomains: intakeEmailSettingsTable.allowedDomains,
      blockedDomains: intakeEmailSettingsTable.blockedDomains,
    })
    .from(intakeEmailSettingsTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, intakeEmailSettingsTable.projectId),
    )
    .where(
      route.kind === "instance"
        ? inArray(intakeEmailSettingsTable.addressToken, tokens)
        : eq(intakeEmailSettingsTable.projectId, route.projectId),
    );
}

async function rememberMessage(
  projectId: string,
  intakeItemId: string,
  key: string,
) {
  await db
    .insert(intakeEmailMessageTable)
    .values({ projectId, intakeItemId, messageId: key })
    .onConflictDoNothing();
}

async function alreadySeen(projectId: string, key: string) {
  const [row] = await db
    .select({ id: intakeEmailMessageTable.id })
    .from(intakeEmailMessageTable)
    .where(
      and(
        eq(intakeEmailMessageTable.projectId, projectId),
        eq(intakeEmailMessageTable.messageId, key),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The request a reply belongs to, by its thread ids. */
async function threadItem(projectId: string, threadIds: readonly string[]) {
  const ids = [...new Set(threadIds.map((id) => id.toLowerCase()))].slice(
    0,
    50,
  );
  if (ids.length === 0) return null;
  const [row] = await db
    .select({
      id: intakeItemTable.id,
      taskId: intakeItemTable.taskId,
      submitterEmail: intakeItemTable.submitterEmail,
    })
    .from(intakeEmailMessageTable)
    .innerJoin(
      intakeItemTable,
      eq(intakeItemTable.id, intakeEmailMessageTable.intakeItemId),
    )
    .where(
      and(
        eq(intakeEmailMessageTable.projectId, projectId),
        inArray(intakeEmailMessageTable.messageId, ids),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function touchSettings(projectId: string) {
  await db
    .update(intakeEmailSettingsTable)
    .set({ lastReceivedAt: new Date() })
    .where(eq(intakeEmailSettingsTable.projectId, projectId));
}

async function withinRate(projectId: string, sender: string) {
  const [bySender, byProject] = await Promise.all([
    SENDER_HOURLY.consume(`${projectId}:${sender}`),
    PROJECT_HOURLY.consume(projectId),
  ]);
  return (bySender?.allowed ?? true) && (byProject?.allowed ?? true);
}

async function addReplyComment(
  target: Target,
  item: { id: string; taskId: string },
  mail: InboundMail,
  sender: MailAddress,
  key: string,
): Promise<InboundOutcome> {
  const limits = intakeEmailLimits();
  const files = await storeEmailAttachments({
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    taskId: item.taskId,
    attachments: mail.attachments,
    limits,
  });
  const body = descriptionFromBody(stripQuotedReply(mail.text));
  const content =
    `${body}${attachmentLines(files.stored)}${skippedNote(files.skipped)}`.trim() ||
    "(empty reply)";
  const author = (sender.name ?? sender.address).slice(0, 200);

  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId: item.taskId,
      type: "comment",
      content,
      externalUserName: author,
      externalSource: "email",
      externalUrl: `mid:${key}`,
    })
    .onConflictDoNothing({
      target: [
        activityTable.taskId,
        activityTable.externalSource,
        activityTable.externalUrl,
      ],
    })
    .returning();
  await rememberMessage(target.projectId, item.id, key);
  await touchSettings(target.projectId);
  if (!activity) {
    return {
      status: "ignored",
      projectId: target.projectId,
      reason: "duplicate",
    };
  }

  for (const file of files.stored) {
    await publishEvent("task.attachment_added", {
      taskId: item.taskId,
      projectId: target.projectId,
      userId: null,
      attachmentId: file.id,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
    });
  }
  await publishEvent("comment.created", {
    ...activity,
    comment: `**${author}** commented:\n> ${content}`,
    projectId: target.projectId,
    visibility: "internal",
    origin: "app",
  });
  await notifyTaskEvent({
    taskId: item.taskId,
    kind: "comment",
    actorId: null,
    eventData: {
      commenterName: author,
      commentId: activity.id,
      commentPreview: plainTextPreview(content),
    },
  });
  return {
    status: "commented",
    projectId: target.projectId,
    intakeItemId: item.id,
  };
}

function attachmentLines(stored: readonly StoredAttachment[]): string {
  if (stored.length === 0) return "";
  return `\n\nAttachments: ${stored.map((file) => file.filename).join(", ")}`;
}

async function fileRequest(
  target: Target,
  mail: InboundMail,
  sender: MailAddress,
  key: string,
): Promise<InboundOutcome> {
  const limits = intakeEmailLimits();
  const item = await submitIntakeItem({
    projectId: target.projectId,
    submittedBy: null,
    title: titleFromSubject(mail.subject, sender.address),
    description: descriptionFromBody(mail.text),
    priority: "no-priority",
    source: "email",
    submitter: {
      email: sender.address,
      name: sender.name?.slice(0, 200) ?? null,
    },
  });
  await rememberMessage(target.projectId, item.id, key);
  const files = await storeEmailAttachments({
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    taskId: item.taskId,
    attachments: mail.attachments,
    limits,
  });
  if (files.skipped.length > 0) {
    // Recorded on the request, so triagers know a file was left out.
    const note = skippedNote(files.skipped);
    const description = `${descriptionFromBody(mail.text)}${note}`;
    await db
      .update(taskTable)
      .set({ description })
      .where(eq(taskTable.id, item.taskId));
  }
  await touchSettings(target.projectId);
  return {
    status: "created",
    projectId: target.projectId,
    intakeItemId: item.id,
  };
}

/** Files one message into every project it reaches. */
export async function receiveInboundMail(
  mail: InboundMail,
  route: InboundRoute,
): Promise<InboundOutcome[]> {
  const rows = await targetsFor(route, mail);
  if (rows.length === 0) {
    return [{ status: "ignored", projectId: null, reason: "no_project" }];
  }

  const limits = intakeEmailLimits();
  const sender = mail.from;
  const outcomes: InboundOutcome[] = [];
  for (const row of rows) {
    const ignore = (reason: IgnoreReason) =>
      outcomes.push({ status: "ignored", projectId: row.projectId, reason });

    if (!row.enabled || !row.intakeEnabled || row.archivedAt || row.deletedAt) {
      ignore("no_project");
      continue;
    }
    if (mail.size > limits.maxMessageBytes) {
      ignore("too_large");
      continue;
    }
    if (!sender) {
      ignore("no_sender");
      continue;
    }
    const loop = loopReason(
      mail.headers,
      sender.address,
      mail.contentType,
      ownAddresses(),
    );
    if (loop) {
      ignore(loop);
      continue;
    }
    if (isSpam(mail.headers, mail.spamScore)) {
      ignore("spam");
      continue;
    }
    const domain = senderDomainReason(
      sender.address,
      row.allowedDomains ?? [],
      row.blockedDomains ?? [],
    );
    if (domain) {
      ignore(domain);
      continue;
    }
    const key = messageKey(mail);
    if (await alreadySeen(row.projectId, key)) {
      ignore("duplicate");
      continue;
    }
    if (!(await withinRate(row.projectId, sender.address))) {
      ignore("rate_limited");
      continue;
    }

    const target: Target = {
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      allowedDomains: row.allowedDomains ?? [],
      blockedDomains: row.blockedDomains ?? [],
    };
    const thread = await threadItem(row.projectId, mail.threadIds);
    // Only the original sender can add to a request by replying.
    if (thread && thread.submitterEmail?.toLowerCase() === sender.address) {
      outcomes.push(await addReplyComment(target, thread, mail, sender, key));
    } else {
      outcomes.push(await fileRequest(target, mail, sender, key));
    }
  }
  return outcomes;
}
