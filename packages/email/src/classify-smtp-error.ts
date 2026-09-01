export type SmtpTestCode =
  | "ok"
  | "auth"
  | "connection"
  | "tls"
  | "timeout"
  | "sender"
  | "recipient"
  | "unknown";

export type SmtpTestResult = {
  sent: boolean;
  code: SmtpTestCode;
  message: string;
};

export const SMTP_TEST_MESSAGES: Record<SmtpTestCode, string> = {
  ok: "The test email was sent.",
  auth: "The SMTP server rejected the username or password.",
  connection: "Couldn't connect to the SMTP server. Check the host and port.",
  timeout: "The SMTP server didn't answer in time.",
  tls: "The secure connection failed. Check the security setting and the server certificate.",
  sender: "The server refused the sender address. Check the From address.",
  recipient: "The server refused the recipient address.",
  unknown:
    "Couldn't send the test email. Check the settings and the server logs.",
};

/** Marks the overall time limit of a test send. */
export class SmtpTestTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor() {
    super("The SMTP test timed out");
    this.name = "SmtpTestTimeoutError";
  }
}

const TLS_CODES = new Set([
  "ETLS",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
]);

const CONNECTION_CODES = new Set([
  "ECONNECTION",
  "EDNS",
  "ESOCKET",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const TLS_TEXT =
  /certificate|self[- ]signed|altnames|wrong version number|ssl routines|tls|handshake/i;
const CONNECTION_TEXT =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/;

function field(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;
}

function classify(error: unknown): SmtpTestCode {
  const code = String(field(error, "code") ?? "");
  const message = String(field(error, "message") ?? error ?? "");
  const command = String(field(error, "command") ?? "");
  const responseCode = Number(field(error, "responseCode"));

  if (error instanceof SmtpTestTimeoutError || code === "ETIMEDOUT") {
    return "timeout";
  }
  if (code === "EAUTH" || responseCode === 535) return "auth";
  if (TLS_CODES.has(code) || TLS_TEXT.test(message)) return "tls";
  if (CONNECTION_CODES.has(code) || CONNECTION_TEXT.test(message)) {
    return "connection";
  }
  if (/MAIL FROM/i.test(command) || /invalid sender/i.test(message)) {
    return "sender";
  }
  if (
    /RCPT TO/i.test(command) ||
    /recipients were rejected|invalid recipient|no recipients/i.test(message)
  ) {
    return "recipient";
  }
  return "unknown";
}

/** Maps a transport error to a curated result; never echoes server text. */
export function classifySmtpError(error: unknown): SmtpTestResult {
  const code = classify(error);
  return { sent: false, code, message: SMTP_TEST_MESSAGES[code] };
}
