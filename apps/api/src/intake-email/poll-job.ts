import { lookup } from "node:dns/promises";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import db from "../database";
import { intakeEmailSettingsTable, projectTable } from "../database/schema";
import { withJobLease } from "../scheduler/leader-lock";
import { isDisallowedAddress } from "../utils/assert-public-destination";
import { openSecret } from "../utils/secret-box";
import {
  defaultImapPort,
  type ImapMailbox,
  instanceImapMailbox,
  intakeEmailLimits,
} from "./config";
import { ImapClient, ImapError } from "./imap";
import {
  type InboundRoute,
  inboundFromParsed,
  receiveInboundMail,
} from "./inbound";
import { parseMail } from "./mime";

// Polls the instance mailbox and every project mailbox for unread mail
// (#8), on one instance at a time. Polling dials out, so it works behind a
// VPN or NAT with no inbound port. A message is marked read once filed or
// ignored; one that fails to process is retried, up to three times.

export const INTAKE_EMAIL_POLL_LEASE = "intake-email-poll";
export const IMAP_SECRET_PURPOSE = "intake-imap";
const LEASE_MS = 10 * 60 * 1000;
const MAX_MESSAGES_PER_MAILBOX = 50;
const MAX_ATTEMPTS = 3;

const failures = new Map<string, number>();

/**
 * The address to dial for a project's mail server: private and loopback
 * addresses are refused (as for webhooks) unless the instance allows them.
 */
export async function resolveMailHost(host: string): Promise<string> {
  const allowPrivate = ["true", "1"].includes(
    process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS ?? "",
  );
  if (allowPrivate) return host;
  if (isDisallowedAddress(host)) {
    throw new ImapError("The mail server is on a private network");
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  const first = addresses[0];
  if (!first) throw new ImapError("The mail server's name doesn't resolve");
  if (addresses.some((entry) => isDisallowedAddress(entry.address))) {
    throw new ImapError("The mail server is on a private network");
  }
  return first.address;
}

export async function pollMailbox(
  mailbox: ImapMailbox,
  route: InboundRoute,
  address?: string,
): Promise<{ filed: number }> {
  const limits = intakeEmailLimits();
  const client = await ImapClient.connect(mailbox, address);
  let filed = 0;
  try {
    await client.login(mailbox.username, mailbox.password);
    await client.select(mailbox.folder);
    const uids = (await client.searchUnseen()).slice(
      0,
      MAX_MESSAGES_PER_MAILBOX,
    );
    const scope =
      route.kind === "instance" ? "instance" : `project:${route.projectId}`;
    for (const uid of uids) {
      const failureKey = `${scope}:${mailbox.host}:${mailbox.username}:${uid}`;
      try {
        const size = await client.fetchSize(uid);
        if (size === null || size <= limits.maxMessageBytes) {
          const raw = await client.fetchMessage(uid, limits.maxMessageBytes);
          if (raw) {
            const outcomes = await receiveInboundMail(
              inboundFromParsed(parseMail(raw), raw.byteLength),
              route,
            );
            filed += outcomes.filter((o) => o.status !== "ignored").length;
          }
        }
        await client.markSeen(uid);
        failures.delete(failureKey);
      } catch (error) {
        // An IMAP error leaves the connection unusable: give up on this
        // mailbox for now (the attempt still counts).
        const attempts = (failures.get(failureKey) ?? 0) + 1;
        failures.set(failureKey, attempts);
        console.error("Failed to file an intake email", error);
        if (attempts >= MAX_ATTEMPTS) {
          failures.delete(failureKey);
          await client.markSeen(uid);
        }
        if (error instanceof ImapError) throw error;
      }
    }
  } finally {
    await client.logout();
  }
  return { filed };
}

/** A safe, short error for the settings page; never the password. */
export function mailboxErrorText(error: unknown): string {
  if (error instanceof ImapError) return error.message.slice(0, 300);
  if (error instanceof Error && "code" in error) {
    return `Connection failed (${String(error.code)})`;
  }
  return "Couldn't read the mailbox";
}

async function projectMailboxes() {
  return db
    .select({
      projectId: intakeEmailSettingsTable.projectId,
      host: intakeEmailSettingsTable.imapHost,
      port: intakeEmailSettingsTable.imapPort,
      security: intakeEmailSettingsTable.imapSecurity,
      username: intakeEmailSettingsTable.imapUsername,
      password: intakeEmailSettingsTable.imapPassword,
      folder: intakeEmailSettingsTable.imapFolder,
    })
    .from(intakeEmailSettingsTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, intakeEmailSettingsTable.projectId),
    )
    .where(
      and(
        eq(intakeEmailSettingsTable.enabled, true),
        eq(intakeEmailSettingsTable.imapEnabled, true),
        isNotNull(intakeEmailSettingsTable.imapHost),
        isNotNull(intakeEmailSettingsTable.imapPassword),
        eq(projectTable.intakeEnabled, true),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    );
}

async function runPoll(): Promise<{ filed: number; degraded: boolean }> {
  let filed = 0;
  let degraded = false;

  const instance = instanceImapMailbox();
  if (instance) {
    try {
      filed += (await pollMailbox(instance, { kind: "instance" })).filed;
    } catch (error) {
      degraded = true;
      console.error(
        "Failed to poll the intake mailbox",
        mailboxErrorText(error),
      );
    }
  }

  for (const row of await projectMailboxes()) {
    let lastError: string | null = null;
    try {
      const mailbox: ImapMailbox = {
        host: row.host ?? "",
        port: row.port ?? defaultImapPort(row.security),
        security: row.security,
        username: row.username ?? "",
        password: openSecret(IMAP_SECRET_PURPOSE, row.password ?? ""),
        folder: row.folder,
      };
      const address = await resolveMailHost(mailbox.host);
      filed += (
        await pollMailbox(
          mailbox,
          { kind: "project", projectId: row.projectId },
          address,
        )
      ).filed;
    } catch (error) {
      degraded = true;
      lastError = mailboxErrorText(error);
    }
    await db
      .update(intakeEmailSettingsTable)
      .set({ lastPolledAt: new Date(), lastError })
      .where(eq(intakeEmailSettingsTable.projectId, row.projectId));
  }
  return { filed, degraded };
}

export async function pollIntakeMailboxes(): Promise<{
  filed: number;
  degraded: boolean;
}> {
  // Most installs have no mailbox: one read, no lease write.
  if (!instanceImapMailbox()) {
    const [any] = await db
      .select({ id: intakeEmailSettingsTable.id })
      .from(intakeEmailSettingsTable)
      .where(
        and(
          eq(intakeEmailSettingsTable.enabled, true),
          eq(intakeEmailSettingsTable.imapEnabled, true),
        ),
      )
      .limit(1);
    if (!any) return { filed: 0, degraded: false };
  }
  return withJobLease(
    INTAKE_EMAIL_POLL_LEASE,
    runPoll,
    () => ({ filed: 0, degraded: false }),
    LEASE_MS,
  );
}
