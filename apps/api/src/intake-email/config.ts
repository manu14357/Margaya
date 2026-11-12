// Instance-level email intake settings (#8), read from the environment on
// every call so tests and restarts see changes. Projects add their own
// mailbox and filters in the database (intake_email_settings).

const MB = 1024 * 1024;

export const DEFAULT_MAX_MESSAGE_BYTES = 25 * MB;
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * MB;
export const DEFAULT_MAX_ATTACHMENTS = 10;

export type ImapSecurity = "tls" | "starttls";

export type ImapMailbox = {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
  folder: string;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function positiveInt(name: string, fallback: number): number {
  const value = Number(env(name));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function parseImapSecurity(value: string): ImapSecurity {
  return value.toLowerCase() === "starttls" ? "starttls" : "tls";
}

export function defaultImapPort(security: ImapSecurity): number {
  return security === "starttls" ? 143 : 993;
}

export type IntakeEmailLimits = {
  maxMessageBytes: number;
  maxAttachmentBytes: number;
  maxAttachments: number;
};

export function intakeEmailLimits(): IntakeEmailLimits {
  return {
    maxMessageBytes: positiveInt(
      "INTAKE_EMAIL_MAX_BYTES",
      DEFAULT_MAX_MESSAGE_BYTES,
    ),
    maxAttachmentBytes: positiveInt(
      "INTAKE_EMAIL_MAX_ATTACHMENT_BYTES",
      DEFAULT_MAX_ATTACHMENT_BYTES,
    ),
    maxAttachments: positiveInt(
      "INTAKE_EMAIL_MAX_ATTACHMENTS",
      DEFAULT_MAX_ATTACHMENTS,
    ),
  };
}

const BASE_ADDRESS = /^([^\s@+]+)@([^\s@]+\.[^\s@]+)$/;

/**
 * The instance's base intake address (`requests@example.com`), split into
 * local part and domain, or null when unset or malformed. Each project's
 * forwarding address is `requests+<token>@example.com`.
 */
export function intakeBaseAddress(): { local: string; domain: string } | null {
  const match = BASE_ADDRESS.exec(env("INTAKE_EMAIL_ADDRESS").toLowerCase());
  if (!match?.[1] || !match[2]) return null;
  return { local: match[1], domain: match[2] };
}

/** The forwarding address of a project, or null without a base address. */
export function projectForwardingAddress(token: string): string | null {
  const base = intakeBaseAddress();
  return base ? `${base.local}+${token}@${base.domain}` : null;
}

/** The instance mailbox polled for every project's forwarding address. */
export function instanceImapMailbox(): ImapMailbox | null {
  const host = env("INTAKE_IMAP_HOST");
  const username = env("INTAKE_IMAP_USER");
  const password = process.env.INTAKE_IMAP_PASSWORD ?? "";
  if (!host || !username || !password) return null;
  const security = parseImapSecurity(env("INTAKE_IMAP_SECURITY"));
  return {
    host,
    port: positiveInt("INTAKE_IMAP_PORT", defaultImapPort(security)),
    security,
    username,
    password,
    folder: env("INTAKE_IMAP_FOLDER") || "INBOX",
  };
}

/** The shared secret of the inbound webhook; null keeps the route off. */
export function inboundWebhookSecret(): string | null {
  const secret = process.env.INTAKE_EMAIL_WEBHOOK_SECRET ?? "";
  return secret.length >= 16 ? secret : null;
}

/**
 * Addresses mail must never be filed from, so the server can't answer
 * itself: the intake base address and the SMTP sender.
 */
export function ownAddresses(): string[] {
  const own: string[] = [];
  const base = intakeBaseAddress();
  if (base) own.push(`${base.local}@${base.domain}`);
  const from = env("SMTP_FROM").toLowerCase();
  const match = /<([^>]+)>/.exec(from)?.[1] ?? from;
  if (match.includes("@")) own.push(match.trim());
  return own;
}
