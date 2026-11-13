// Block Kit builders shared by the Slack app (commands, unfurls,
// interactions) and the outbound Slack plugin. Every text that came from
// Margaya or a user is escaped before it goes into mrkdwn.

export type SlackBlock = Record<string, unknown>;

export type SlackMessage = {
  text: string;
  blocks?: SlackBlock[];
  response_type?: "ephemeral" | "in_channel";
  replace_original?: boolean;
};

export const ACTION_ASSIGN_ME = "margaya_assign_me";
export const ACTION_SET_STATUS = "margaya_set_status";
export const ACTION_OPEN = "margaya_open";
export const SHORTCUT_CREATE_TASK = "margaya_create_task";
export const MODAL_CREATE_TASK = "margaya_create_task_modal";

/** Slack's limit for a static_select. */
const MAX_OPTIONS = 100;

export function escapeSlack(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

export function sentenceCase(value: string | null | undefined): string {
  if (!value) return "None";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export type StatusOption = { slug: string; name: string };

/** Assign to me, Change status and Open, for a task. */
export function taskActionsBlock(input: {
  taskId: string;
  taskUrl: string;
  statuses: readonly StatusOption[];
  currentStatus?: string | null;
}): SlackBlock {
  const elements: SlackBlock[] = [
    {
      type: "button",
      action_id: ACTION_ASSIGN_ME,
      text: { type: "plain_text", text: "Assign to me" },
      value: input.taskId,
    },
  ];
  const options = input.statuses.slice(0, MAX_OPTIONS).map((status) => ({
    text: { type: "plain_text", text: truncate(status.name, 75) },
    value: `${input.taskId}::${status.slug}`.slice(0, 150),
  }));
  if (options.length > 0) {
    const current = options.find(
      (option) => option.value === `${input.taskId}::${input.currentStatus}`,
    );
    elements.push({
      type: "static_select",
      action_id: ACTION_SET_STATUS,
      placeholder: { type: "plain_text", text: "Change status" },
      options,
      ...(current ? { initial_option: current } : {}),
    });
  }
  elements.push({
    type: "button",
    action_id: ACTION_OPEN,
    text: { type: "plain_text", text: "Open" },
    url: input.taskUrl,
  });
  return {
    type: "actions",
    block_id: `margaya_task_${input.taskId}`,
    elements,
  };
}

/** Splits a status select value back into the task and the column slug. */
export function parseStatusValue(
  value: unknown,
): { taskId: string; status: string } | null {
  if (typeof value !== "string") return null;
  const index = value.indexOf("::");
  if (index <= 0) return null;
  const taskId = value.slice(0, index);
  const status = value.slice(index + 2);
  return taskId && status ? { taskId, status } : null;
}

export type TaskPreview = {
  id: string;
  key: string;
  title: string;
  url: string;
  projectName: string;
  statusName: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  assigneeNames: string[];
  statuses: StatusOption[];
};

export function taskPreviewBlocks(
  preview: TaskPreview,
  options: { actions?: boolean } = {},
): SlackBlock[] {
  const due = preview.dueDate ? preview.dueDate.slice(0, 10) : "None";
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${preview.url}|${escapeSlack(preview.key)} ${escapeSlack(truncate(preview.title, 200))}>*`,
      },
      fields: [
        {
          type: "mrkdwn",
          text: `*Project*\n${escapeSlack(preview.projectName)}`,
        },
        {
          type: "mrkdwn",
          text: `*Status*\n${escapeSlack(preview.statusName)}`,
        },
        {
          type: "mrkdwn",
          text: `*Priority*\n${escapeSlack(sentenceCase(preview.priority))}`,
        },
        { type: "mrkdwn", text: `*Due*\n${escapeSlack(due)}` },
        {
          type: "mrkdwn",
          text: `*Assignees*\n${
            preview.assigneeNames.length > 0
              ? escapeSlack(truncate(preview.assigneeNames.join(", "), 200))
              : "Nobody"
          }`,
        },
      ],
    },
  ];
  if (options.actions) {
    blocks.push(
      taskActionsBlock({
        taskId: preview.id,
        taskUrl: preview.url,
        statuses: preview.statuses,
        currentStatus: preview.status,
      }),
    );
  }
  return blocks;
}

export function ephemeral(text: string, blocks?: SlackBlock[]): SlackMessage {
  return { response_type: "ephemeral", text, ...(blocks ? { blocks } : {}) };
}

export function linkPromptMessage(linkUrl: string): SlackMessage {
  const text =
    "Link your Slack account to Margaya first. Everything you do here then runs as your Margaya account, with exactly your permissions.";
  return ephemeral(text, [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          action_id: "margaya_link_account",
          text: { type: "plain_text", text: "Link account" },
          url: linkUrl,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "The link works for 15 minutes and only for you.",
        },
      ],
    },
  ]);
}

export const HELP_TEXT = [
  "*Margaya in Slack*",
  "`/margaya search <words>`: find tasks you can see.",
  "`/margaya WEB-12`: preview a task by its key.",
  "`/margaya add [PROJECT] <title> @person #label !priority <date>`: capture a task. Without a project key it goes to the workspace's default project.",
  "`/margaya link` / `/margaya unlink`: connect or disconnect your Margaya account.",
  "Message menu › *Create Margaya task*: turn a message into a task or an intake request.",
].join("\n");
