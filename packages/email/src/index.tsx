export {
  classifySmtpError,
  SMTP_TEST_MESSAGES,
  type SmtpTestCode,
  type SmtpTestResult,
} from "./classify-smtp-error";
export { OTP_EXPIRY_SECONDS } from "./otp-expiry";
export {
  type EmailResult,
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
export type {
  NotificationBatchChange,
  NotificationBatchEmailProps,
  NotificationBatchGroup,
} from "./templates/notification-batch";
export type {
  DigestMention,
  DigestTask,
  DigestWorkspace,
  NotificationDigestEmailProps,
} from "./templates/notification-digest";
export { sendTestEmail } from "./test-email";
