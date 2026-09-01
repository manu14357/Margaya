import type SMTPTransport from "nodemailer/lib/smtp-transport";

type SmtpEnv = Record<string, string | undefined>;

export type SmtpSecurity = "tls" | "starttls" | "none";

/** The effective SMTP settings, from the environment or the API's provider. */
export type SmtpConfig = {
  host: string;
  /** null lets nodemailer pick the default port of the security mode. */
  port: number | null;
  security: SmtpSecurity;
  user: string;
  password: string;
  from: string;
};

/** Returns the SMTP settings to use right now, or null when there are none. */
export type SmtpConfigProvider = () => SmtpConfig | null;

const IGNORE_TLS_MESSAGE =
  "SMTP_IGNORE_TLS=true is no longer supported: it disables STARTTLS, not certificate validation. Remove it and trust your SMTP CA using NODE_EXTRA_CA_CERTS. For an intentionally unencrypted local relay, set SMTP_SECURE=false and SMTP_REQUIRE_TLS=false explicitly.";

/** Refuses the retired SMTP_IGNORE_TLS flag (checked at startup too). */
export function assertSupportedSmtpEnv(env: SmtpEnv = process.env): void {
  if (env.SMTP_IGNORE_TLS === "true") {
    throw new Error(IGNORE_TLS_MESSAGE);
  }
}

/**
 * Build the nodemailer transport options from the environment.
 *
 * `auth` is only included when both a user and a password are set. Passing an
 * `auth` object with undefined values makes nodemailer authenticate anyway,
 * which fails against relays that accept unauthenticated mail. The same goes
 * for `port`: leaving it out lets nodemailer pick the default for the chosen
 * security mode instead of receiving NaN.
 */
export function getSmtpTransportOptions(
  env: SmtpEnv = process.env,
): SMTPTransport.Options {
  assertSupportedSmtpEnv(env);

  const options: SMTPTransport.Options = {
    host: env.SMTP_HOST,
    secure: env.SMTP_SECURE !== "false",
    requireTLS: env.SMTP_REQUIRE_TLS !== "false",
    ignoreTLS: false,
  };

  if (env.SMTP_PORT) {
    options.port = Number(env.SMTP_PORT);
  }

  if (env.SMTP_USER && env.SMTP_PASSWORD) {
    options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASSWORD };
  }

  return options;
}

/** The security mode the SMTP_SECURE and SMTP_REQUIRE_TLS flags describe. */
export function smtpSecurityFromEnv(env: SmtpEnv = process.env): SmtpSecurity {
  if (env.SMTP_SECURE !== "false") return "tls";
  if (env.SMTP_REQUIRE_TLS !== "false") return "starttls";
  return "none";
}

/** The default provider: today's environment rules. */
export function smtpConfigFromEnv(env: SmtpEnv = process.env): SmtpConfig {
  assertSupportedSmtpEnv(env);
  const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : null;
  return {
    host: env.SMTP_HOST ?? "",
    port,
    security: smtpSecurityFromEnv(env),
    user: env.SMTP_USER ?? "",
    password: env.SMTP_PASSWORD ?? "",
    from: env.SMTP_FROM ?? "",
  };
}

/** Nodemailer options for a config. Certificate validation always stays on. */
export function smtpTransportOptions(
  config: SmtpConfig,
): SMTPTransport.Options {
  const options: SMTPTransport.Options = {
    host: config.host,
    secure: config.security === "tls",
    requireTLS: config.security !== "none",
    ignoreTLS: false,
  };
  if (config.port) {
    options.port = config.port;
  }
  if (config.user && config.password) {
    options.auth = { user: config.user, pass: config.password };
  }
  return options;
}

/** Host and sender are what sending requires. */
export function isSmtpConfigComplete(config: SmtpConfig | null): boolean {
  return Boolean(config?.host) && Boolean(config?.from);
}

let provider: SmtpConfigProvider = () => smtpConfigFromEnv();

/**
 * Installs where SMTP settings come from (the API installs its instance
 * settings). `null` restores the environment provider.
 */
export function setSmtpConfigProvider(next: SmtpConfigProvider | null): void {
  provider = next ?? (() => smtpConfigFromEnv());
}

/** The current settings from the installed provider. */
export function currentSmtpConfig(): SmtpConfig | null {
  return provider();
}

/**
 * Whether outgoing mail can be sent at all. This is what the send helpers
 * actually require: a host to connect to and an envelope sender. With an
 * explicit environment it checks that environment only.
 */
export function isSmtpConfigured(env?: SmtpEnv): boolean {
  if (env) return Boolean(env.SMTP_HOST) && Boolean(env.SMTP_FROM);
  return isSmtpConfigComplete(currentSmtpConfig());
}
