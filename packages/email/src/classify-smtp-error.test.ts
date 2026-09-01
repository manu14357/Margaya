import { describe, expect, it } from "vitest";
import {
  classifySmtpError,
  SMTP_TEST_MESSAGES,
  SmtpTestTimeoutError,
} from "./classify-smtp-error";

function smtpError(
  message: string,
  fields: { code?: string; responseCode?: number; command?: string },
) {
  return Object.assign(new Error(message), fields);
}

describe("classifySmtpError", () => {
  it.each([
    [
      "auth",
      smtpError("Invalid login: 535 5.7.8 rejected", {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
      }),
    ],
    ["auth", smtpError("rejected", { responseCode: 535 })],
    [
      "connection",
      smtpError("connect ECONNREFUSED 127.0.0.1:2525", { code: "ESOCKET" }),
    ],
    [
      "connection",
      smtpError("getaddrinfo ENOTFOUND smtp.invalid", { code: "EDNS" }),
    ],
    ["connection", smtpError("unreachable", { code: "EHOSTUNREACH" })],
    ["timeout", smtpError("Greeting never received", { code: "ETIMEDOUT" })],
    ["timeout", new SmtpTestTimeoutError()],
    ["tls", smtpError("self-signed certificate", { code: "ESOCKET" })],
    [
      "tls",
      smtpError("Hostname/IP does not match certificate's altnames", {
        code: "ESOCKET",
      }),
    ],
    [
      "tls",
      smtpError("Error initiating TLS - wrong version number", {
        code: "ETLS",
      }),
    ],
    [
      "sender",
      smtpError("Mail command failed: 553 sender rejected", {
        code: "EENVELOPE",
        responseCode: 553,
        command: "MAIL FROM",
      }),
    ],
    [
      "recipient",
      smtpError("Can't send mail - all recipients were rejected", {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
      }),
    ],
    ["unknown", smtpError("Unexpected Response", { code: "EPROTOCOL" })],
    ["unknown", "a plain string"],
  ])("maps to %s", (code, error) => {
    expect(classifySmtpError(error)).toEqual({
      sent: false,
      code,
      message: SMTP_TEST_MESSAGES[code as keyof typeof SMTP_TEST_MESSAGES],
    });
  });

  it("never echoes the server's text", () => {
    const result = classifySmtpError(
      smtpError("Invalid login: user secret-user", { code: "EAUTH" }),
    );
    expect(result.message).not.toContain("secret-user");
  });
});
