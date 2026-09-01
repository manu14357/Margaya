import { createHash } from "node:crypto";
import * as nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  currentSmtpConfig,
  type SmtpConfig,
  smtpConfigFromEnv,
  smtpTransportOptions,
} from "./smtp-config";

type Transporter = nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

let cached: { fingerprint: string; transporter: Transporter } | null = null;

function fingerprintOf(options: SMTPTransport.Options): string {
  return createHash("sha256").update(JSON.stringify(options)).digest("hex");
}

/**
 * The transport for the current settings. It is built lazily and reused while
 * the settings stay the same; new settings build a new one and close the old.
 */
export function getSmtpTransport(
  config: SmtpConfig = currentSmtpConfig() ?? smtpConfigFromEnv({}),
): Transporter {
  const options = smtpTransportOptions(config);
  const fingerprint = fingerprintOf(options);
  if (cached?.fingerprint === fingerprint) return cached.transporter;

  const previous = cached?.transporter;
  cached = { fingerprint, transporter: nodemailer.createTransport(options) };
  previous?.close();
  return cached.transporter;
}

/** The sender for the current settings. */
export function getSmtpFrom(): string | undefined {
  return currentSmtpConfig()?.from || undefined;
}

/** Test hook: drops the cached transport. */
export function resetSmtpTransport(): void {
  cached?.transporter.close();
  cached = null;
}
