import { Section, Text } from "@react-email/components";
import React from "react";
import { EmailShell, styles } from "./shell";

void React;

export type TestEmailProps = {
  instanceName: string;
};

export function testEmailSubject(instanceName: string): string {
  return `Test email from ${instanceName}`;
}

export function testEmailText(instanceName: string): string {
  return `This is a test email from ${instanceName}. If you can read it, email delivery works.`;
}

const TestEmail = ({ instanceName }: TestEmailProps) => (
  <EmailShell
    preview={testEmailSubject(instanceName)}
    title={testEmailSubject(instanceName)}
  >
    <Section>
      <Text style={styles.paragraph}>{testEmailText(instanceName)}</Text>
      <Section style={styles.divider} />
      <Text style={styles.footer}>Margaya</Text>
    </Section>
  </EmailShell>
);

TestEmail.PreviewProps = { instanceName: "Margaya" } as TestEmailProps;

export default TestEmail;
