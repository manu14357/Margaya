import { Link, Section, Text } from "@react-email/components";
import React from "react";
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

const messages = {
  en: {
    title: { daily: "Your daily digest", weekly: "Your weekly digest" },
    preview: "Your Margaya summary",
    subtitle:
      "Your open tasks that are overdue or due within 7 days, and what is new in your inbox.",
    dueHeading: "Due soon and overdue",
    overdue: "Overdue",
    due: "Due",
    more: (count: number) => `and ${count} more`,
    mentionsHeading: (count: number) =>
      count === 1 ? "1 new mention" : `${count} new mentions`,
    unread: (count: number) =>
      count === 1
        ? "1 unread notification in your inbox"
        : `${count} unread notifications in your inbox`,
    openInbox: "Open inbox",
    manage: "Manage notification settings",
    footer: "You chose to receive this digest.",
    blockedHeading: "Blocked",
    waitingOn: (keys: string) => `Waiting on ${keys}`,
    hiddenBlockers: (count: number) =>
      count === 1 ? "1 task you can't see" : `${count} tasks you can't see`,
    followingHeading: "Changes on tasks you follow",
    changes: (count: number) => (count === 1 ? "1 change" : `${count} changes`),
  },
  de: {
    title: {
      daily: "Deine taegliche Zusammenfassung",
      weekly: "Deine woechentliche Zusammenfassung",
    },
    preview: "Deine Margaya-Zusammenfassung",
    subtitle:
      "Deine offenen Aufgaben, die ueberfaellig oder in 7 Tagen faellig sind, und Neues in deinem Posteingang.",
    dueHeading: "Bald faellig und ueberfaellig",
    overdue: "Ueberfaellig",
    due: "Faellig",
    more: (count: number) => `und ${count} weitere`,
    mentionsHeading: (count: number) =>
      count === 1 ? "1 neue Erwaehnung" : `${count} neue Erwaehnungen`,
    unread: (count: number) =>
      count === 1
        ? "1 ungelesene Benachrichtigung im Posteingang"
        : `${count} ungelesene Benachrichtigungen im Posteingang`,
    openInbox: "Posteingang oeffnen",
    manage: "Benachrichtigungseinstellungen verwalten",
    footer: "Du hast diese Zusammenfassung abonniert.",
    blockedHeading: "Blockiert",
    waitingOn: (keys: string) => `Wartet auf ${keys}`,
    hiddenBlockers: (count: number) =>
      count === 1
        ? "1 Aufgabe, die du nicht sehen kannst"
        : `${count} Aufgaben, die du nicht sehen kannst`,
    followingHeading: "Aenderungen an Aufgaben, denen du folgst",
    changes: (count: number) =>
      count === 1 ? "1 Aenderung" : `${count} Aenderungen`,
  },
  vi: {
    title: {
      daily: "Bản tóm tắt hằng ngày",
      weekly: "Bản tóm tắt hằng tuần",
    },
    preview: "Bản tóm tắt Margaya của bạn",
    subtitle:
      "Công việc đang mở đã quá hạn hoặc đến hạn trong 7 ngày, và nội dung mới trong hộp thư.",
    dueHeading: "Sắp đến hạn và quá hạn",
    overdue: "Quá hạn",
    due: "Hạn",
    more: (count: number) => `và ${count} công việc khác`,
    mentionsHeading: (count: number) => `${count} lượt nhắc mới`,
    unread: (count: number) => `${count} thông báo chưa đọc trong hộp thư`,
    openInbox: "Mở hộp thư",
    manage: "Quản lý cài đặt thông báo",
    footer: "Bạn đã chọn nhận bản tóm tắt này.",
    blockedHeading: "Đang bị chặn",
    waitingOn: (keys: string) => `Đang chờ ${keys}`,
    hiddenBlockers: (count: number) => `${count} công việc bạn không xem được`,
    followingHeading: "Thay đổi trên công việc bạn theo dõi",
    changes: (count: number) => `${count} thay đổi`,
  },
  ja: {
    title: { daily: "毎日のダイジェスト", weekly: "毎週のダイジェスト" },
    preview: "Margaya のまとめ",
    subtitle:
      "期限切れまたは 7 日以内に期限を迎える未完了タスクと、受信トレイの新着です。",
    dueHeading: "期限間近・期限切れ",
    overdue: "期限切れ",
    due: "期限",
    more: (count: number) => `ほか ${count} 件`,
    mentionsHeading: (count: number) => `${count} 件の新しいメンション`,
    unread: (count: number) => `受信トレイに未読の通知が ${count} 件あります`,
    openInbox: "受信トレイを開く",
    manage: "通知設定を管理",
    footer: "このダイジェストの受信を選択しています。",
    blockedHeading: "ブロック中",
    waitingOn: (keys: string) => `${keys} を待っています`,
    hiddenBlockers: (count: number) => `表示できないタスク ${count} 件`,
    followingHeading: "フォロー中のタスクの変更",
    changes: (count: number) => `${count} 件の変更`,
  },
} as const;

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
  const copy = messages[resolveEmailLocale(locale)];

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
                    {copy.more(workspace.moreDueTasks)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {workspace.mentionCount > 0 ? (
              <>
                <Text style={sectionHeading}>
                  {copy.mentionsHeading(workspace.mentionCount)}
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
                      ? [copy.hiddenBlockers(task.hiddenBlockers)]
                      : []),
                  ].join(", ");
                  return (
                    <Text key={task.url} style={line}>
                      {"• "}
                      <Link href={task.url} style={{ color: "#047857" }}>
                        {task.title}
                      </Link>
                      <span style={{ color: "#5f6b65" }}>
                        {` · ${copy.waitingOn(waiting)} · ${task.projectName}`}
                      </span>
                    </Text>
                  );
                })}
                {workspace.brief.moreBlocked > 0 ? (
                  <Text style={{ ...styles.muted, margin: "4px 0 0" }}>
                    {copy.more(workspace.brief.moreBlocked)}
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
                      {` · ${copy.changes(task.changes)} · ${task.projectName}`}
                    </span>
                  </Text>
                ))}
                {workspace.brief.moreFollowing > 0 ? (
                  <Text style={{ ...styles.muted, margin: "4px 0 0" }}>
                    {copy.more(workspace.brief.moreFollowing)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {workspace.unreadCount > 0 ? (
              <Text style={{ ...line, margin: "10px 0 0" }}>
                {copy.unread(workspace.unreadCount)} ·{" "}
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
