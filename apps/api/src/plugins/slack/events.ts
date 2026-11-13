import { and, asc, eq, ne } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  projectTable,
  projectUpdateTable,
  slackConnectionTable,
  taskTable,
  userTable,
  workspaceTable,
} from "../../database/schema";
import { taskActionsBlock } from "../../slack-app/blocks";
import type {
  IntakeDecidedEvent,
  PluginContext,
  ProjectUpdatePostedEvent,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
} from "../types";
import { postToSlack } from "./client";
import type { SlackConfig, SlackEventKey } from "./config";
import { normalizeSlackConfig } from "./config";

type SlackEventData = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  taskTitle: string;
  taskNumber: number | null;
  projectName: string;
  taskUrl: string | null;
  actorName: string | null;
  status: string | null;
  priority: string | null;
};

function isEnabled(config: SlackConfig, key: SlackEventKey): boolean {
  return config.events?.[key] ?? false;
}

function escapeSlack(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toSentenceCase(value: string | null): string {
  if (!value) return "Unknown";
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

async function getSlackEventData(
  taskId: string,
  projectId: string,
  userId: string | null,
): Promise<SlackEventData | null> {
  const [taskRow] = await db
    .select({
      title: taskTable.title,
      number: taskTable.number,
      status: taskTable.status,
      priority: taskTable.priority,
      projectName: projectTable.name,
      projectId: projectTable.id,
      workspaceId: workspaceTable.id,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .innerJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(and(eq(taskTable.id, taskId), eq(projectTable.id, projectId)))
    .limit(1);

  if (!taskRow) {
    return null;
  }

  const [user] = userId
    ? await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1)
    : [];

  const clientUrl = process.env.MARGAYA_CLIENT_URL || "http://localhost:5173";
  const taskUrl = `${clientUrl}/dashboard/workspace/${taskRow.workspaceId}/project/${taskRow.projectId}/task/${taskId}`;

  return {
    taskId,
    projectId: taskRow.projectId,
    workspaceId: taskRow.workspaceId,
    taskTitle: taskRow.title,
    taskNumber: taskRow.number,
    projectName: taskRow.projectName,
    taskUrl,
    actorName: user?.name ?? null,
    status: taskRow.status,
    priority: taskRow.priority,
  };
}

/**
 * Assign to me, Change status and Open, when the workspace has an active
 * Slack app: Slack sends the clicks to that app, which runs them as the
 * clicking user's linked Margaya account. Without it, no buttons.
 */
async function actionsBlockFor(data: SlackEventData) {
  if (!data.taskUrl) return null;
  const [connection] = await db
    .select({ id: slackConnectionTable.id })
    .from(slackConnectionTable)
    .where(
      and(
        eq(slackConnectionTable.workspaceId, data.workspaceId),
        eq(slackConnectionTable.isActive, true),
      ),
    )
    .limit(1);
  if (!connection) return null;
  const statuses = await db
    .select({ slug: columnTable.slug, name: columnTable.name })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, data.projectId),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));
  return taskActionsBlock({
    taskId: data.taskId,
    taskUrl: data.taskUrl,
    statuses,
    currentStatus: data.status,
  });
}

async function sendSlackMessage(
  config: SlackConfig,
  title: string,
  body: string,
  data: SlackEventData,
  options: { actions?: boolean } = {},
): Promise<void> {
  const actions =
    options.actions === false ? null : await actionsBlockFor(data);
  const issueKey =
    data.taskNumber !== null ? `#${data.taskNumber}` : "Task update";
  const escapedIssueKey = escapeSlack(issueKey);
  const escapedTaskTitle = escapeSlack(data.taskTitle);
  const taskLabel = data.taskUrl
    ? `<${data.taskUrl}|${escapedIssueKey} ${escapedTaskTitle}>`
    : `${escapedIssueKey} ${escapedTaskTitle}`;
  const escapedTitle = escapeSlack(title);
  const escapedBody = escapeSlack(body);

  await postToSlack(config.webhookUrl, {
    text: `${title}: ${data.taskTitle}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapedTitle}*\n${escapedBody}`,
        },
        fields: [
          {
            type: "mrkdwn",
            text: `*Task*\n${taskLabel}`,
          },
          {
            type: "mrkdwn",
            text: `*Project*\n${escapeSlack(data.projectName)}`,
          },
          {
            type: "mrkdwn",
            text: `*Status*\n${escapeSlack(toSentenceCase(data.status))}`,
          },
          {
            type: "mrkdwn",
            text: `*Priority*\n${escapeSlack(toSentenceCase(data.priority))}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: data.actorName
              ? `Triggered by ${escapeSlack(data.actorName)}`
              : "Triggered by Margaya",
          },
        ],
      },
      ...(actions ? [actions] : []),
    ],
  });
}

export async function handleTaskCreated(
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskCreated")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "New task created",
    `A new task was added: *${event.title}*`,
    data,
  );
}

export async function handleTaskStatusChanged(
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskStatusChanged")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "Task status changed",
    `*${event.title}* moved from *${toSentenceCase(event.oldStatus)}* to *${toSentenceCase(event.newStatus)}*.`,
    data,
  );
}

export async function handleTaskPriorityChanged(
  event: TaskPriorityChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskPriorityChanged")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "Task priority changed",
    `*${event.title}* changed from *${toSentenceCase(event.oldPriority)}* to *${toSentenceCase(event.newPriority)}*.`,
    data,
  );
}

export async function handleTaskTitleChanged(
  event: TaskTitleChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskTitleChanged")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "Task title changed",
    `Task renamed from *${truncate(event.oldTitle, 120)}* to *${truncate(event.newTitle, 120)}*.`,
    data,
  );
}

export async function handleTaskDescriptionChanged(
  event: TaskDescriptionChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskDescriptionChanged")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "Task description changed",
    `The task description was updated${event.newDescription ? `: ${truncate(event.newDescription.replace(/\s+/g, " "), 160)}` : "."}`,
    data,
  );
}

export async function handleTaskCommentCreated(
  event: TaskCommentCreatedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskCommentCreated")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "New task comment",
    truncate(event.comment.replace(/\s+/g, " "), 200),
    data,
  );
}

function formatDay(value: Date | string | null): string {
  if (!value) return "no due date";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "no due date"
    : date.toISOString().slice(0, 10);
}

export async function handleTaskDueDateChanged(
  event: TaskDueDateChangedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "taskDueDateChanged")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  await sendSlackMessage(
    config,
    "Task due date changed",
    `*${event.title}* is now due *${formatDay(event.newDueDate)}* (was ${formatDay(event.oldDueDate)}).`,
    data,
  );
}

export async function handleIntakeDecided(
  event: IntakeDecidedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "intakeDecision")) return;

  const data = await getSlackEventData(
    event.taskId,
    event.projectId,
    event.userId,
  );
  if (!data) return;

  const body =
    event.decision === "accepted"
      ? `Request *${event.title}* was accepted${event.columnName ? ` into *${event.columnName}*` : ""}.`
      : event.decision === "duplicate"
        ? `Request *${event.title}* was closed as a duplicate${event.duplicateKey ? ` of *${event.duplicateKey}*` : ""}.`
        : `Request *${event.title}* was declined.`;

  await sendSlackMessage(config, "Intake decision", body, data, {
    // Only an accepted request is a board task the buttons can act on.
    actions: event.decision === "accepted",
  });
}

const HEALTH_LABELS: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

export async function handleProjectUpdatePosted(
  event: ProjectUpdatePostedEvent,
  context: PluginContext,
): Promise<void> {
  const config = normalizeSlackConfig(context.config as SlackConfig);
  if (!isEnabled(config, "projectUpdate")) return;

  const [row] = await db
    .select({
      health: projectUpdateTable.health,
      summary: projectUpdateTable.summary,
      aiProvenance: projectUpdateTable.aiProvenance,
      projectName: projectTable.name,
      workspaceId: projectTable.workspaceId,
      authorName: userTable.name,
    })
    .from(projectUpdateTable)
    .innerJoin(projectTable, eq(projectUpdateTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(projectUpdateTable.authorId, userTable.id))
    .where(
      and(
        eq(projectUpdateTable.id, event.updateId),
        eq(projectUpdateTable.projectId, event.projectId),
      ),
    )
    .limit(1);
  if (!row) return;

  const clientUrl = process.env.MARGAYA_CLIENT_URL || "http://localhost:5173";
  const url = `${clientUrl}/dashboard/workspace/${row.workspaceId}/project/${event.projectId}/updates`;
  const health = HEALTH_LABELS[row.health] ?? toSentenceCase(row.health);
  const footer = [
    row.authorName
      ? `Posted by ${escapeSlack(row.authorName)}`
      : "Posted in Margaya",
    // AI-written text stays labelled wherever it goes.
    ...(row.aiProvenance ? ["Drafted with AI"] : []),
  ].join(" · ");
  const summary = truncate(row.summary.replace(/\s+/g, " "), 400);

  await postToSlack(config.webhookUrl, {
    text: `Project update for ${row.projectName}: ${health}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${url}|Project update: ${escapeSlack(row.projectName)}>*\n*${escapeSlack(health)}*. ${escapeSlack(summary)}`,
        },
      },
      { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
    ],
  });
}
