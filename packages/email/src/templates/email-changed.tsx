import { Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, fill } from "./copy";
import { EmailShell, styles } from "./shell";

void React;

export type EmailChangedEmailProps = {
  /** The new address, already masked by the caller (j***@example.com). */
  newEmail: string;
  locale?: string | null;
};

const EmailChangedEmail = ({ newEmail, locale }: EmailChangedEmailProps) => {
  const copy = emailCopy(locale).emailChanged;

  return (
    <EmailShell preview={copy.preview} title={copy.title}>
      <Section>
        <Text style={styles.paragraph}>
          {fill(copy.body, { email: newEmail })}
        </Text>
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
