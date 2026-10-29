import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { emailCopy, fill, plural } from "./copy";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type DigestTask = {
  title: string;
  url: string;
  projectName: string;
  /** The due date, already formatted for the reader. */
  dueLabel: string;
  overdue: boolean;
};

export type DigestMention = {
  /** The notification id. */
  id: string;
  /** e.g. "Ada mentioned you" */
  title: string;
  /** e.g. "You were mentioned in Launch plan." */
  detail: string;
  url: string | null;
};

/** My brief in the digest (opt-in): blocked and followed tasks. */
export type DigestBrief = {
  blocked: Array<{
    title: string;
    url: string;
    projectName: string;
    /** Keys of the open blockers the reader can see. */
    blockers: string[];
    /** Blockers in projects the reader can't see. */
    hiddenBlockers: number;
  }>;
  moreBlocked: number;
  following: Array<{
    title: string;
    url: string;
    projectName: string;
    changes: number;
  }>;
  moreFollowing: number;
};

export type DigestWorkspace = {
  name: string;
  inboxUrl: string;
  dueTasks: DigestTask[];
  /** Due or overdue tasks beyond the listed ones. */
  moreDueTasks: number;
  mentions: DigestMention[];
  /** Every new mention since the last digest, listed or not. */
  mentionCount: number;
  /** Unread inbox notifications that arrived since the last digest. */
  unreadCount: number;
  /** Present when the reader added My brief to the digest. */
  brief?: DigestBrief;
};

export type NotificationDigestEmailProps = {
  frequency: "daily" | "weekly";
  workspaces: DigestWorkspace[];
  settingsUrl: string;
  locale?: string | null;
};

const workspaceStyle = {
  margin: "0 0 16px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(0, 0, 0, 0.08)",
};

const workspaceTitle = {
  ...styles.paragraph,
  margin: "0 0 8px",
  fontWeight: "600",
  fontSize: "16px",
};

const sectionHeading = {
  ...styles.paragraph,
  margin: "10px 0 2px",
  fontWeight: "600",
};

const line = {
  ...styles.paragraph,
  margin: "4px 0 0",
};

const NotificationDigestEmail = ({
  frequency,
  workspaces,
  settingsUrl,
  locale,
}: NotificationDigestEmailProps) => {
  const lang = resolveEmailLocale(locale);
  const copy = emailCopy(lang).notificationDigest;

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title[frequency]}
      subtitle={copy.subtitle}
    >
      <Section>
        {workspaces.map((workspace) => (
          <Section key={workspace.inboxUrl} style={workspaceStyle}>
            <Text style={workspaceTitle}>{workspace.name}</Text>
            {workspace.dueTasks.length > 0 ? (
              <>
                <Text style={sectionHeading}>{copy.dueHeading}</Text>
                {workspace.dueTasks.map((task) => (
                  <Text key={task.url} style={line}>
                    {"• "}
                    <Link href={task.url} style={{ color: "#047857" }}>
                      {task.title}
                    </Link>
                    <span
                      style={{ color: task.overdue ? "#b91c1c" : "#5f6b65" }}
                    >
                      {` · ${task.overdue ? copy.overdue : copy.due} ${task.dueLabel} · ${task.projectName}`}
                    </span>
                  </Text>
                ))}
                {workspace.moreDueTasks > 0 ? (
                  <Text style={{ ...styles.muted, margin: "4px 0 0" }}>
                    {plural(copy, "more", lang, workspace.moreDueTasks)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {workspace.mentionCount > 0 ? (
              <>
                <Text style={sectionHeading}>
                  {plural(
                    copy,
                    "mentionsHeading",
                    lang,
                    workspace.mentionCount,
                  )}
                </Text>
                {workspace.mentions.map((mention) => (
                  <Text key={mention.id} style={line}>
                    {"• "}
                    {mention.url ? (
                      <Link href={mention.url} style={{ color: "#047857" }}>
                        {mention.title}
                      </Link>
                    ) : (
                      mention.title
                    )}
                    <span style={{ color: "#5f6b65" }}>
                      {` · ${mention.detail}`}
                    </span>
                  </Text>
                ))}
              </>
            ) : null}
            {workspace.brief && workspace.brief.blocked.length > 0 ? (
              <>
                <Text style={sectionHeading}>{copy.blockedHeading}</Text>
                {workspace.brief.blocked.map((task) => {
                  const waiting = [
                    ...task.blockers,
                    ...(task.hiddenBlockers > 0
                      ? [
                          plural(
                            copy,
                            "hiddenBlockers",
                            lang,
                            task.hiddenBlockers,
                          ),
                        ]
                      : []),
                  ].join(", ");
                  return (
                    <Text key={task.url} style={line}>
                      {"• "}
                      <Link href={task.url} style={{ color: "#047857" }}>
                        {task.title}
                      </Link>
                      <span style={{ color: "#5f6b65" }}>
                        {` · ${fill(copy.waitingOn, { keys: waiting })} · ${task.projectName}`}
                      </span>
                    </Text>
                  );
                })}
                {workspace.brief.moreBlocked > 0 ? (
                  <Text style={{ ...styles.muted, margin: "4px 0 0" }}>
                    {plural(copy, "more", lang, workspace.brief.moreBlocked)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {workspace.brief && workspace.brief.following.length > 0 ? (
              <>
                <Text style={sectionHeading}>{copy.followingHeading}</Text>
                {workspace.brief.following.map((task) => (
                  <Text key={task.url} style={line}>
                    {"• "}
                    <Link href={task.url} style={{ color: "#047857" }}>
                      {task.title}
                    </Link>
                    <span style={{ color: "#5f6b65" }}>
                      {` · ${plural(copy, "changes", lang, task.changes)} · ${task.projectName}`}
                    </span>
                  </Text>
                ))}
                {workspace.brief.moreFollowing > 0 ? (
                  <Text style={{ ...styles.muted, margin: "4px 0 0" }}>
                    {plural(copy, "more", lang, workspace.brief.moreFollowing)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {workspace.unreadCount > 0 ? (
              <Text style={{ ...line, margin: "10px 0 0" }}>
                {plural(copy, "unread", lang, workspace.unreadCount)} ·{" "}
                <Link href={workspace.inboxUrl}>{copy.openInbox}</Link>
              </Text>
            ) : null}
          </Section>
        ))}
        <Link style={styles.button} href={settingsUrl}>
          {copy.manage}
        </Link>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

NotificationDigestEmail.PreviewProps = {
  frequency: "daily",
  workspaces: [
    {
      name: "Acme",
      inboxUrl: "https://margaya.app/inbox",
      dueTasks: [
        {
          title: "Ship the onboarding flow",
          url: "https://margaya.app/task/1",
          projectName: "Website",
          dueLabel: "Oct 12",
          overdue: true,
        },
      ],
      moreDueTasks: 0,
      mentions: [
        {
          id: "n-1",
          title: "Ada mentioned you",
          detail: "You were mentioned in Launch plan.",
          url: "https://margaya.app/task/2",
        },
      ],
      mentionCount: 1,
      unreadCount: 4,
    },
  ],
  settingsUrl: "https://margaya.app/settings",
} as NotificationDigestEmailProps;

export default NotificationDigestEmail;
