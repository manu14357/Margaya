import { render } from "@react-email/components";
import { config } from "dotenv-mono";
import type { ReactElement } from "react";
import { assertSupportedSmtpEnv, isSmtpConfigured } from "./smtp-config";
import { getSmtpFrom, getSmtpTransport } from "./smtp-transport";
import EmailChangedEmail, {
  type EmailChangedEmailProps,
} from "./templates/email-changed";
import type { MagicLinkEmailProps } from "./templates/magic-link";
import MagicLinkEmail from "./templates/magic-link";
import NotificationEmail, {
  type NotificationEmailProps,
} from "./templates/notification";
import NotificationBatchEmail, {
  type NotificationBatchEmailProps,
} from "./templates/notification-batch";
import NotificationDigestEmail, {
  type NotificationDigestEmailProps,
} from "./templates/notification-digest";
import type { OtpEmailProps } from "./templates/otp";
import OtpEmail from "./templates/otp";
import PasswordResetEmail, {
  type PasswordResetEmailProps,
} from "./templates/password-reset";
import TrialReminderEmail, {
  type TrialReminderEmailProps,
} from "./templates/trial-reminder";
import WorkspaceInvitationEmail, {
  type WorkspaceInvitationEmailProps,
} from "./templates/workspace-invitation";

config();

// The transport itself is built lazily from the current settings, but the
// retired SMTP_IGNORE_TLS flag still stops the server at startup.
assertSupportedSmtpEnv();

export const sendMagicLinkEmail = async (
  to: string,
  subject: string,
  data: MagicLinkEmailProps,
) => {
  const emailTemplate = await render(MagicLinkEmail(data));
  try {
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
  } catch (error) {
    console.error("Error sending magic link email", error);
  }
};

export const sendOtpEmail = async (
  to: string,
  subject: string,
  data: OtpEmailProps,
) => {
  const emailTemplate = await render(OtpEmail(data));
  try {
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
  } catch (error) {
    console.error("Error sending OTP email", error);
  }
};

export const sendPasswordResetEmail = async (
  to: string,
  subject: string,
  data: PasswordResetEmailProps,
) => {
  const emailTemplate = await render(PasswordResetEmail(data));
  try {
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
  } catch (error) {
    console.error("Error sending password reset email", error);
  }
};

/** Tells the previous address that the account's email changed. */
export const sendEmailChangedEmail = async (
  to: string,
  subject: string,
  data: EmailChangedEmailProps,
) => {
  if (!isSmtpConfigured()) return;
  const emailTemplate = await render(EmailChangedEmail(data));
  try {
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
  } catch (error) {
    console.error("Error sending email-changed notice", error);
  }
};

export type EmailResult = {
  success: boolean;
  reason?: "SMTP_NOT_CONFIGURED";
};

export const sendWorkspaceInvitationEmail = async (
  to: string,
  subject: string,
  data: WorkspaceInvitationEmailProps,
): Promise<EmailResult> => {
  if (!isSmtpConfigured()) {
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const emailTemplate = await render(
      WorkspaceInvitationEmail({ ...data, to }),
    );
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
    return { success: true };
  } catch (error) {
    console.error("Error sending workspace invitation email", error);
    throw error;
  }
};

export const sendNotificationEmail = async (
  to: string,
  subject: string,
  data: NotificationEmailProps,
): Promise<EmailResult> => {
  if (!isSmtpConfigured()) {
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const emailTemplate = await render(NotificationEmail(data));
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
    return { success: true };
  } catch (error) {
    console.error("Error sending notification email", error);
    throw error;
  }
};

// Batched and digest emails carry a plain-text part too: they are longer
// lists that text-only clients should still read well.
async function sendHtmlAndText(
  to: string,
  subject: string,
  element: ReactElement,
): Promise<EmailResult> {
  if (!isSmtpConfigured()) {
    return { success: false, reason: "SMTP_NOT_CONFIGURED" };
  }
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  await getSmtpTransport().sendMail({
    from: getSmtpFrom(),
    to,
    subject,
    html,
    text,
  });
  return { success: true };
}

/** One email listing several notifications, grouped by task. Throws on failure. */
export const sendNotificationBatchEmail = (
  to: string,
  subject: string,
  data: NotificationBatchEmailProps,
): Promise<EmailResult> =>
  sendHtmlAndText(to, subject, NotificationBatchEmail(data));

/** The optional daily or weekly digest. Throws on failure. */
export const sendNotificationDigestEmail = (
  to: string,
  subject: string,
  data: NotificationDigestEmailProps,
): Promise<EmailResult> =>
  sendHtmlAndText(to, subject, NotificationDigestEmail(data));

export const sendTrialReminderEmail = async (
  to: string,
  subject: string,
  data: TrialReminderEmailProps,
) => {
  const emailTemplate = await render(TrialReminderEmail(data));
  try {
    await getSmtpTransport().sendMail({
      from: getSmtpFrom(),
      to,
      subject,
      html: emailTemplate,
    });
  } catch (error) {
    console.error("Error sending trial reminder email", error);
  }
};
