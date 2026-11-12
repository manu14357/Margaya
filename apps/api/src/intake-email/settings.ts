import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { intakeEmailSettingsTable } from "../database/schema";
import { openSecret, sealSecret } from "../utils/secret-box";
import {
  defaultImapPort,
  inboundWebhookSecret,
  instanceImapMailbox,
  intakeBaseAddress,
  intakeEmailLimits,
  projectForwardingAddress,
} from "./config";
import { normalizeDomainList } from "./filters";
import { ImapClient } from "./imap";
import {
  IMAP_SECRET_PURPOSE,
  mailboxErrorText,
  resolveMailHost,
} from "./poll-job";

// Project email intake settings (#8). Reading and changing them needs
// project:share, like the public board: both open the queue to outsiders.

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 20;

/** 20 lower-case letters and digits: safe in any mailbox's local part. */
export function generateAddressToken(): string {
  let token = "";
  while (token.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(32)) {
      // 252 = 7 * 36: drop the bytes that would bias the modulo.
      if (byte >= 252) continue;
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === TOKEN_LENGTH) break;
    }
  }
  return token;
}

type Row = typeof intakeEmailSettingsTable.$inferSelect;

async function loadRow(projectId: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(intakeEmailSettingsTable)
    .where(eq(intakeEmailSettingsTable.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** The settings response; the IMAP password never leaves the server. */
export function toEmailSettings(projectId: string, row: Row | null) {
  return {
    projectId,
    enabled: row?.enabled ?? false,
    address: row ? projectForwardingAddress(row.addressToken) : null,
    instance: {
      address: Boolean(intakeBaseAddress()),
      mailbox: Boolean(instanceImapMailbox()),
      webhook: Boolean(inboundWebhookSecret()),
    },
    allowedDomains: row?.allowedDomains ?? [],
    blockedDomains: row?.blockedDomains ?? [],
    imap: {
      enabled: row?.imapEnabled ?? false,
      host: row?.imapHost ?? null,
      port: row?.imapPort ?? null,
      security: row?.imapSecurity ?? "tls",
      username: row?.imapUsername ?? null,
      folder: row?.imapFolder ?? "INBOX",
      hasPassword: Boolean(row?.imapPassword),
    },
    limits: intakeEmailLimits(),
    lastPolledAt: row?.lastPolledAt ?? null,
    lastReceivedAt: row?.lastReceivedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function getEmailSettings(projectId: string) {
  return toEmailSettings(projectId, await loadRow(projectId));
}

export type EmailSettingsInput = {
  enabled?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  imap?: {
    enabled?: boolean;
    host?: string | null;
    port?: number | null;
    security?: "tls" | "starttls";
    username?: string | null;
    /** Omitted keeps the stored one; null or "" removes it. */
    password?: string | null;
    folder?: string;
  };
};

function domains(values: string[] | undefined, label: string) {
  if (values === undefined) return undefined;
  const { domains: clean, invalid } = normalizeDomainList(values);
  if (invalid.length > 0) {
    throw new HTTPException(400, {
      message: `${label}: "${invalid[0]}" isn't a domain`,
    });
  }
  return clean;
}

export async function updateEmailSettings(
  projectId: string,
  input: EmailSettingsInput,
) {
  const existing = await loadRow(projectId);
  const imap = input.imap ?? {};
  const values: Partial<typeof intakeEmailSettingsTable.$inferInsert> = {};
  if (input.enabled !== undefined) values.enabled = input.enabled;
  const allowed = domains(input.allowedDomains, "Allowed domains");
  const blocked = domains(input.blockedDomains, "Blocked domains");
  if (allowed) values.allowedDomains = allowed;
  if (blocked) values.blockedDomains = blocked;
  if (imap.enabled !== undefined) values.imapEnabled = imap.enabled;
  if (imap.host !== undefined) values.imapHost = imap.host?.trim() || null;
  if (imap.port !== undefined) values.imapPort = imap.port;
  if (imap.security !== undefined) values.imapSecurity = imap.security;
  if (imap.username !== undefined) {
    values.imapUsername = imap.username?.trim() || null;
  }
  if (imap.password !== undefined) {
    values.imapPassword = imap.password
      ? sealSecret(IMAP_SECRET_PURPOSE, imap.password)
      : null;
  }
  if (imap.folder !== undefined)
    values.imapFolder = imap.folder.trim() || "INBOX";
  // A changed mailbox starts with a clean status.
  if (Object.keys(imap).length > 0) values.lastError = null;

  const merged = { ...existing, ...values };
  if (
    merged.imapEnabled &&
    (!merged.imapHost || !merged.imapUsername || !merged.imapPassword)
  ) {
    throw new HTTPException(400, {
      message: "A mailbox needs a server, a user name and a password",
    });
  }

  if (existing) {
    if (Object.keys(values).length > 0) {
      await db
        .update(intakeEmailSettingsTable)
        .set(values)
        .where(eq(intakeEmailSettingsTable.projectId, projectId));
    }
  } else {
    await db
      .insert(intakeEmailSettingsTable)
      .values({ projectId, addressToken: generateAddressToken(), ...values })
      .onConflictDoNothing({ target: intakeEmailSettingsTable.projectId });
  }
  return getEmailSettings(projectId);
}

/** A new forwarding address; the old one stops working at once. */
export async function rotateEmailAddress(projectId: string) {
  const existing = await loadRow(projectId);
  if (!existing) {
    throw new HTTPException(404, { message: "Email intake isn't set up" });
  }
  await db
    .update(intakeEmailSettingsTable)
    .set({ addressToken: generateAddressToken() })
    .where(eq(intakeEmailSettingsTable.projectId, projectId));
  return getEmailSettings(projectId);
}

/** Logs in to the stored mailbox and counts unread mail; reads nothing. */
export async function testProjectMailbox(projectId: string) {
  const row = await loadRow(projectId);
  if (!row?.imapHost || !row.imapUsername || !row.imapPassword) {
    throw new HTTPException(400, {
      message: "Save a server, a user name and a password first",
    });
  }
  let client: ImapClient | null = null;
  try {
    const host = row.imapHost;
    const address = await resolveMailHost(host);
    client = await ImapClient.connect(
      {
        host,
        port: row.imapPort ?? defaultImapPort(row.imapSecurity),
        security: row.imapSecurity,
      },
      address,
    );
    await client.login(
      row.imapUsername,
      openSecret(IMAP_SECRET_PURPOSE, row.imapPassword),
    );
    await client.select(row.imapFolder);
    const unread = (await client.searchUnseen()).length;
    return { ok: true, unread, error: null };
  } catch (error) {
    return { ok: false, unread: null, error: mailboxErrorText(error) };
  } finally {
    await client?.logout();
  }
}
