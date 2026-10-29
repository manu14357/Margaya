import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, fill, plural } from "./copy";
import { type EmailLocale, resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type TrialReminderEmailProps = {
  workspaceName: string;
  daysLeft: number;
  billingUrl: string;
  locale?: string | null;
};

export function trialReminderTitle(
  locale: EmailLocale,
  workspaceName: string,
  daysLeft: number,
): string {
  const copy = emailCopy(locale).trialReminder;
  if (daysLeft <= 0) {
    return fill(copy.endedTitle, { workspaceName });
  }
  // Count first: filling the name first would expand a "{{count}}" typed
  // into the workspace name.
  return fill(plural(copy, "daysLeftTitle", locale, daysLeft), {
    workspaceName,
  });
}

const TrialReminderEmail = ({
  workspaceName,
  daysLeft,
  billingUrl,
  locale,
}: TrialReminderEmailProps) => {
  const resolved = resolveEmailLocale(locale);
  const copy = emailCopy(resolved).trialReminder;
  const title = trialReminderTitle(resolved, workspaceName, daysLeft);

  return (
    <EmailShell
      preview={title}
      title={title}
      subtitle={daysLeft <= 0 ? copy.endedSubtitle : copy.activeSubtitle}
    >
      <Section>
        <Link style={styles.button} href={billingUrl}>
          {copy.cta}
        </Link>
        <Text style={styles.paragraph}>{copy.selfHost}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

TrialReminderEmail.PreviewProps = {
  workspaceName: "Acme",
  daysLeft: 3,
  billingUrl: "https://cloud.margaya.app/dashboard/settings/workspace/billing",
  locale: "en",
} as TrialReminderEmailProps;

export default TrialReminderEmail;
