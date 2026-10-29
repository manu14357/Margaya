import { render } from "@react-email/components";
import * as nodemailer from "nodemailer";
import {
  classifySmtpError,
  SMTP_TEST_MESSAGES,
  type SmtpTestResult,
  SmtpTestTimeoutError,
} from "./classify-smtp-error";
import {
  currentSmtpConfig,
  isSmtpConfigComplete,
  smtpTransportOptions,
} from "./smtp-config";
import TestEmail, {
  testEmailSubject,
  testEmailText,
} from "./templates/test-email";

const DEFAULT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpTestTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Verifies the connection and the credentials of the current settings, then
 * sends a short message. Uses its own transport so a test never disturbs the
 * cached one. The raw error is logged without credentials, never returned.
 */
export async function sendTestEmail(
  to: string,
  options: {
    instanceName: string;
    /** The requesting admin's app locale; English when absent. */
    locale?: string | null;
    timeoutMs?: number;
  },
): Promise<SmtpTestResult> {
  const config = currentSmtpConfig();
  if (!config || !isSmtpConfigComplete(config)) {
    return {
      sent: false,
      code: "unknown",
      message: SMTP_TEST_MESSAGES.unknown,
    };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stepTimeout = Math.max(1_000, timeoutMs - 1_000);
  const transport = nodemailer.createTransport({
    ...smtpTransportOptions(config),
    connectionTimeout: stepTimeout,
    greetingTimeout: stepTimeout,
    socketTimeout: stepTimeout,
  });

  try {
    await withTimeout(
      (async () => {
        await transport.verify();
        const { instanceName, locale } = options;
        const html = await render(TestEmail({ instanceName, locale }));
        await transport.sendMail({
          from: config.from,
          to,
          subject: testEmailSubject(instanceName, locale),
          text: testEmailText(instanceName, locale),
          html,
        });
      })(),
      timeoutMs,
    );
    return { sent: true, code: "ok", message: SMTP_TEST_MESSAGES.ok };
  } catch (error) {
    const result = classifySmtpError(error);
    const details =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    console.error("Test email failed", {
      classification: result.code,
      code: details.code,
      responseCode: details.responseCode,
      command: details.command,
      message: details.message,
    });
    return result;
  } finally {
    transport.close();
  }
}
