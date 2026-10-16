import { Section, Text } from "@react-email/components";
import React from "react";
import { OTP_EXPIRY_SECONDS } from "../otp-expiry";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type OtpEmailProps = {
  otp: string;
  locale?: string | null;
  /** What the code is for; sign-in when omitted. */
  purpose?: "sign-in" | "email-verification" | "email-change";
};

const messages = {
  en: {
    preview: "Your Margaya verification code",
    title: "Your verification code",
    subtitle: "Enter this one-time code to finish signing in.",
    verifySubtitle: "Enter this one-time code to verify your email address.",
    changeSubtitle:
      "Enter this one-time code to confirm this as the new email address of your Margaya account.",
    code: "is your Margaya verification code.",
    expiry: `This code expires in ${OTP_EXPIRY_SECONDS / 60} minutes.`,
    ignore: "If you didn't request this, you can ignore this email.",
    footer: "Margaya security email",
  },
  de: {
    preview: "Dein Margaya Bestätigungscode",
    title: "Dein Bestätigungscode",
    subtitle: "Gib diesen Einmalcode ein, um die Anmeldung abzuschließen.",
    verifySubtitle:
      "Gib diesen Einmalcode ein, um deine E-Mail-Adresse zu bestätigen.",
    changeSubtitle:
      "Gib diesen Einmalcode ein, um diese Adresse als neue E-Mail-Adresse deines Margaya-Kontos zu bestätigen.",
    code: "ist dein Margaya Bestätigungscode.",
    expiry: `Dieser Code läuft in ${OTP_EXPIRY_SECONDS / 60} Minuten ab.`,
    ignore:
      "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    footer: "Margaya Sicherheits-E-Mail",
  },
  vi: {
    preview: "Mã xác minh Margaya của bạn",
    title: "Mã xác minh của bạn",
    subtitle: "Nhập mã dùng một lần này để hoàn tất đăng nhập.",
    verifySubtitle:
      "Nhập mã dùng một lần này để xác minh địa chỉ email của bạn.",
    changeSubtitle:
      "Nhập mã dùng một lần này để xác nhận đây là địa chỉ email mới cho tài khoản Margaya của bạn.",
    code: "là mã xác minh Margaya của bạn.",
    expiry: `Mã này sẽ hết hạn sau ${OTP_EXPIRY_SECONDS / 60} phút.`,
    ignore: "Nếu bạn không yêu cầu điều này, bạn có thể bỏ qua email này.",
    footer: "Email bảo mật Margaya",
  },
  ja: {
    preview: "Margaya の確認コード",
    title: "確認コード",
    subtitle:
      "サインインを完了するには、このワンタイムコードを入力してください。",
    verifySubtitle:
      "メールアドレスを確認するには、このワンタイムコードを入力してください。",
    changeSubtitle:
      "このアドレスを Margaya アカウントの新しいメールアドレスとして確認するには、このワンタイムコードを入力してください。",
    code: "はあなたの Margaya 確認コードです。",
    expiry: `このコードの有効期限は${OTP_EXPIRY_SECONDS / 60}分です。`,
    ignore: "心当たりがない場合は、このメールを無視してかまいません。",
    footer: "Margaya セキュリティメール",
  },
} as const;

const OtpEmail = ({ otp, locale, purpose }: OtpEmailProps) => {
  const copy = messages[resolveEmailLocale(locale)];

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={
        purpose === "email-verification"
          ? copy.verifySubtitle
          : purpose === "email-change"
            ? copy.changeSubtitle
            : copy.subtitle
      }
    >
      <Section>
        <Text style={styles.paragraph}>
          {otp} {copy.code}
        </Text>
        <Text style={styles.code}>{otp}</Text>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

OtpEmail.PreviewProps = {
  otp: "123456",
  locale: "en-US",
} as OtpEmailProps;

export default OtpEmail;
