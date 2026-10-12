import type { EmailResult } from "../../../packages/email/src/send-email";

export { OTP_EXPIRY_SECONDS } from "../../../packages/email/src/otp-expiry";

export async function sendMagicLinkEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendOtpEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendPasswordResetEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<void> {
  return undefined;
}

export async function sendWorkspaceInvitationEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
  return { success: true };
}

export async function sendNotificationEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
  return { success: true };
}

export async function sendNotificationBatchEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
  return { success: true };
}

export async function sendNotificationDigestEmail(
  _to: string,
  _subject: string,
  _data: unknown,
): Promise<EmailResult> {
  return { success: true };
}

export function isSmtpConfigured(): boolean {
  return false;
}

export { classifySmtpError } from "../../../packages/email/src/classify-smtp-error";

export function setSmtpConfigProvider(_provider: unknown): void {}

type TestEmailResult = Awaited<
  ReturnType<
    typeof import("../../../packages/email/src/test-email").sendTestEmail
  >
>;

let nextTestEmailResult: TestEmailResult = {
  sent: true,
  code: "ok",
  message: "The test email was sent.",
};

/** Tests choose what the next `sendTestEmail` call answers. */
export function setTestEmailResult(result: TestEmailResult): void {
  nextTestEmailResult = result;
}

export async function sendTestEmail(
  _to: string,
  _options: { instanceName: string },
): Promise<TestEmailResult> {
  return nextTestEmailResult;
}
