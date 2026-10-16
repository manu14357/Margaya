import { Section, Text } from "@react-email/components";
import React from "react";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type EmailChangedEmailProps = {
  /** The new address, already masked by the caller (j***@example.com). */
  newEmail: string;
  locale?: string | null;
};

const messages = {
  en: {
    preview: "Your Margaya email address was changed",
    title: "Your email address was changed",
    body: (email: string) =>
      `The email address of your Margaya account is now ${email}. Sign-in links, codes and notifications go there from now on.`,
    warning:
      "If you didn't make this change, contact your Margaya administrator right away.",
    footer: "Margaya security email",
  },
  de: {
    preview: "Deine Margaya-E-Mail-Adresse wurde geändert",
    title: "Deine E-Mail-Adresse wurde geändert",
    body: (email: string) =>
      `Die E-Mail-Adresse deines Margaya-Kontos lautet jetzt ${email}. Anmeldelinks, Codes und Benachrichtigungen gehen ab sofort dorthin.`,
    warning:
      "Wenn du diese Änderung nicht vorgenommen hast, wende dich sofort an deine Margaya-Administration.",
    footer: "Margaya Sicherheits-E-Mail",
  },
  vi: {
    preview: "Địa chỉ email Margaya của bạn đã được thay đổi",
    title: "Địa chỉ email của bạn đã được thay đổi",
    body: (email: string) =>
      `Địa chỉ email của tài khoản Margaya của bạn giờ là ${email}. Từ nay liên kết đăng nhập, mã và thông báo sẽ được gửi đến địa chỉ đó.`,
    warning:
      "Nếu bạn không thực hiện thay đổi này, hãy liên hệ ngay với quản trị viên Margaya.",
    footer: "Email bảo mật Margaya",
  },
  ja: {
    preview: "Margaya のメールアドレスが変更されました",
    title: "メールアドレスが変更されました",
    body: (email: string) =>
      `Margaya アカウントのメールアドレスは ${email} になりました。今後、ログインリンク、コード、通知はこのアドレスに送信されます。`,
    warning:
      "この変更に心当たりがない場合は、すぐに Margaya の管理者に連絡してください。",
    footer: "Margaya セキュリティメール",
  },
} as const;

const EmailChangedEmail = ({ newEmail, locale }: EmailChangedEmailProps) => {
  const copy = messages[resolveEmailLocale(locale)];

  return (
    <EmailShell preview={copy.preview} title={copy.title}>
      <Section>
        <Text style={styles.paragraph}>{copy.body(newEmail)}</Text>
        <Text style={styles.muted}>{copy.warning}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

EmailChangedEmail.PreviewProps = {
  newEmail: "j***@example.com",
  locale: "en-US",
} as EmailChangedEmailProps;

export default EmailChangedEmail;
