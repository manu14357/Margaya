import { Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, fill } from "./copy";
import { EmailShell, styles } from "./shell";

void React;

export type TestEmailProps = {
  instanceName: string;
  locale?: string | null;
};

export function testEmailSubject(
  instanceName: string,
  locale?: string | null,
): string {
  return fill(emailCopy(locale).testEmail.subject, { instanceName });
}

export function testEmailText(
  instanceName: string,
  locale?: string | null,
): string {
  return fill(emailCopy(locale).testEmail.text, { instanceName });
}

const TestEmail = ({ instanceName, locale }: TestEmailProps) => (
  <EmailShell
    preview={testEmailSubject(instanceName, locale)}
    title={testEmailSubject(instanceName, locale)}
  >
    <Section>
      <Text style={styles.paragraph}>
        {testEmailText(instanceName, locale)}
      </Text>
      <Section style={styles.divider} />
      <Text style={styles.footer}>Margaya</Text>
    </Section>
  </EmailShell>
);

TestEmail.PreviewProps = { instanceName: "Margaya" } as TestEmailProps;

export default TestEmail;
