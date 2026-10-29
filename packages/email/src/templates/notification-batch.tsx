import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, plural } from "./copy";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type NotificationBatchChange = {
  /** Stable and unique within the email, e.g. the notification id. */
  id: string;
  /** One line, e.g. "Task status changed". */
  summary: string;
  /** The detail sentence, e.g. "Draft moved from To do to Done." */
  detail: string;
  /** Who made the change; null for system changes and reminders. */
  actorName: string | null;
};

export type NotificationBatchGroup = {
  /** Stable and unique within the email, e.g. the task id. */
  id: string;
  /** The task title, or the notification title for non-task updates. */
  title: string;
  /** "Workspace / Project", shown under the title. */
  context: string | null;
  url: string | null;
  changes: NotificationBatchChange[];
};

export type NotificationBatchEmailProps = {
  groups: NotificationBatchGroup[];
  settingsUrl: string;
  locale?: string | null;
};

const groupStyle = {
  margin: "0 0 16px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
};

const groupTitle = {
  ...styles.paragraph,
  margin: "0 0 2px",
  fontWeight: "600",
};

const changeLine = {
  ...styles.paragraph,
  margin: "6px 0 0",
};

export function countChanges(groups: NotificationBatchGroup[]) {
  return groups.reduce((total, group) => total + group.changes.length, 0);
}

const NotificationBatchEmail = ({
  groups,
  settingsUrl,
  locale,
}: NotificationBatchEmailProps) => {
  const lang = resolveEmailLocale(locale);
  const copy = emailCopy(lang).notificationBatch;
  const title = plural(copy, "title", lang, countChanges(groups));

  return (
    <EmailShell preview={copy.preview} title={title} subtitle={copy.subtitle}>
      <Section>
        {groups.map((group) => (
          <Section key={group.id} style={groupStyle}>
            <Text style={groupTitle}>
              {group.url ? (
                <Link href={group.url} style={{ color: "#047857" }}>
                  {group.title}
                </Link>
              ) : (
                group.title
              )}
            </Text>
            {group.context ? (
              <Text style={styles.muted}>{group.context}</Text>
            ) : null}
            {group.changes.map((change) => (
              <Text key={change.id} style={changeLine}>
                {"• "}
                {change.detail}
                {change.actorName ? (
                  <span style={{ color: "#5f6b65" }}>
                    {` (${copy.by} ${change.actorName})`}
                  </span>
                ) : null}
              </Text>
            ))}
            {group.url ? (
              <Text style={{ ...styles.muted, margin: "8px 0 0" }}>
                <Link href={group.url}>{copy.open}</Link>
              </Text>
            ) : null}
          </Section>
        ))}
        <Section style={styles.divider} />
        <Text style={styles.footer}>
          {copy.footer} · <Link href={settingsUrl}>{copy.manage}</Link>
        </Text>
      </Section>
    </EmailShell>
  );
};

NotificationBatchEmail.PreviewProps = {
  groups: [
    {
      id: "task-1",
      title: "Design account notifications",
      context: "Acme / Website",
      url: "https://margaya.app",
      changes: [
        {
          id: "n-1",
          summary: "Task status changed",
          detail: "Design account notifications moved from To do to Doing.",
          actorName: "Ada",
        },
        {
          id: "n-2",
          summary: "Ada commented",
          detail: "New comment on Design account notifications: Looks good",
          actorName: "Ada",
        },
      ],
    },
  ],
  settingsUrl: "https://margaya.app",
} as NotificationBatchEmailProps;

export default NotificationBatchEmail;
