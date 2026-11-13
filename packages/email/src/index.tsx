export {
  classifySmtpError,
  SMTP_TEST_MESSAGES,
  type SmtpTestCode,
  type SmtpTestResult,
} from "./classify-smtp-error";
export { OTP_EXPIRY_SECONDS } from "./otp-expiry";
export {
  type EmailResult,
  sendEmailChangedEmail,
  sendMagicLinkEmail,
  sendNotificationBatchEmail,
  sendNotificationDigestEmail,
  sendNotificationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendTrialReminderEmail,
  sendWorkspaceInvitationEmail,
} from "./send-email";
export {
  isSmtpConfigured,
  type SmtpConfig,
  type SmtpConfigProvider,
  type SmtpSecurity,
  setSmtpConfigProvider,
} from "./smtp-config";
export { emailCopy, fill, notificationCopy, plural } from "./templates/copy";
export type {
  EmailMessages,
  NotificationTexts,
} from "./templates/messages.generated";
export type {
  NotificationBatchChange,
  NotificationBatchEmailProps,
  NotificationBatchGroup,
} from "./templates/notification-batch";
export type {
  DigestBrief,
  DigestMention,
  DigestProjectUpdate,
  DigestTask,
  DigestWorkspace,
  NotificationDigestEmailProps,
} from "./templates/notification-digest";
export {
  type EmailLocale,
  emailLocales,
  resolveEmailLocale,
} from "./templates/resolve-locale";
export {
  type SmtpVerifyResult,
  sendTestEmail,
  verifySmtpConnection,
} from "./test-email";
