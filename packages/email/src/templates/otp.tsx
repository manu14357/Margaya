import { Section, Text } from "@react-email/components";
import React from "react";
import { OTP_EXPIRY_SECONDS } from "../otp-expiry";
import { emailCopy, fill } from "./copy";
import { EmailShell, styles } from "./shell";

void React;

export type OtpEmailProps = {
  otp: string;
  locale?: string | null;
  /** What the code is for; sign-in when omitted. */
  purpose?: "sign-in" | "email-verification" | "email-change";
};

const OtpEmail = ({ otp, locale, purpose }: OtpEmailProps) => {
  const copy = emailCopy(locale).otp;

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
        <Text style={styles.paragraph}>
          {fill(copy.expiry, { minutes: OTP_EXPIRY_SECONDS / 60 })}
        </Text>
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
