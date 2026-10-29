import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, fill } from "./copy";
import { EmailShell, styles } from "./shell";

void React;

export type PasswordResetEmailProps = {
  resetLink: string;
  userName?: string;
  locale?: string | null;
};

const PasswordResetEmail = ({
  resetLink,
  userName,
  locale,
}: PasswordResetEmailProps) => {
  const copy = emailCopy(locale).passwordReset;

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={
        userName
          ? fill(copy.subtitleWithName, { name: userName })
          : copy.subtitleDefault
      }
    >
      <Section>
        <Link style={styles.button} href={resetLink}>
          {copy.cta}
        </Link>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

PasswordResetEmail.PreviewProps = {
  resetLink: "https://margaya.app/auth/reset-password?token=example",
  userName: "Jane",
} as PasswordResetEmailProps;

export default PasswordResetEmail;
