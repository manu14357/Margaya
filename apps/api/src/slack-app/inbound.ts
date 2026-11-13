import { publicWebUrl } from "../utils/desktop-config";
import { asLinkedUser, type UserApi } from "./acting-user";
import {
  assignToMe,
  captureTask,
  changeStatus,
  createTaskFromMessage,
  listProjects,
  loadTaskPreview,
  messageDescription,
  searchTasks,
  type TaskRef,
} from "./actions";
import {
  ACTION_ASSIGN_ME,
  ACTION_SET_STATUS,
  ephemeral,
  escapeSlack,
  HELP_TEXT,
  linkPromptMessage,
  MODAL_CREATE_TASK,
  parseStatusValue,
  SHORTCUT_CREATE_TASK,
  type SlackBlock,
  type SlackMessage,
  taskPreviewBlocks,
  truncate,
} from "./blocks";
import { createLinkToken } from "./link-token";
import { unlinkSlackIdentity } from "./links";
import { findLinkedUserId, type LoadedSlackConnection } from "./store";
import { callSlack, respondToSlack } from "./web-api";

// One entry point for everything Slack sends, whichever transport carried it
// (Socket Mode envelope or signed HTTP request). It returns the body Slack
// expects back at once; slower follow-ups run in the background and answer
// through response_url or the Web API.

type Json = Record<string, unknown>;

export type SlackInbound =
  | { kind: "command"; payload: Json }
  | { kind: "interactive"; payload: Json }
  | { kind: "event"; payload: Json };

export type InboundResult = { body?: unknown };

const str = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

function logFailure(where: string, error: unknown) {
  // Never the payload or the credentials: only where and what kind.
  console.error(`slack-app: ${where} failed`, {
    error:
      error instanceof Error
        ? `${error.name}${"code" in error ? `:${String(error.code)}` : ""}`
        : "unknown",
  });
}

function background(where: string, work: () => Promise<unknown>) {
  void work().catch((error) => logFailure(where, error));
}

export function linkUrl(
  connection: LoadedSlackConnection,
  teamId: string,
  slackUserId: string,
  slackUserName: string | null,
): string {
  const token = createLinkToken({
    workspaceId: connection.workspaceId,
    teamId,
    slackUserId,
    slackUserName,
  });
  return `${publicWebUrl()}/dashboard/settings/account/slack?link=${encodeURIComponent(token)}`;
}

type Actor = { teamId: string; slackUserId: string; userName: string | null };

/** Runs `work` as the linked Margaya user, or returns null when unlinked. */
async function asActor<T>(
  connection: LoadedSlackConnection,
  actor: Actor,
  work: (api: UserApi, userId: string) => Promise<T>,
): Promise<{ linked: true; value: T } | { linked: false }> {
  const userId = await findLinkedUserId({
    workspaceId: connection.workspaceId,
    teamId: actor.teamId,
    slackUserId: actor.slackUserId,
  });
  if (!userId) return { linked: false };
  const value = await asLinkedUser(userId, (api) => work(api, userId));
  return { linked: true, value };
}

/** Requests from another Slack team than the connected one are ignored. */
function teamMatches(connection: LoadedSlackConnection, teamId: string | null) {
  return (
    Boolean(teamId) && (!connection.teamId || connection.teamId === teamId)
  );
}

export const TASK_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,15}-\d{1,9}$/;

// ---------------------------------------------------------------- commands

export async function handleCommand(
  connection: LoadedSlackConnection,
  payload: Json,
  today?: Date,
): Promise<SlackMessage> {
  const teamId = str(payload.team_id);
  const slackUserId = str(payload.user_id);
  if (!teamMatches(connection, teamId) || !slackUserId || !teamId) {
    return ephemeral("This Slack workspace isn't connected to Margaya.");
  }
  const actor: Actor = {
    teamId,
    slackUserId,
    userName: str(payload.user_name),
  };
  const text = (str(payload.text) ?? "").trim();
  const [rawVerb = "", ...restWords] = text.split(/\s+/);
  const verb = rawVerb.toLowerCase();
  const rest = restWords.join(" ").trim();

  if (!text || verb === "help") return ephemeral(HELP_TEXT);

  if (verb === "link") {
    const linked = await findLinkedUserId({
      workspaceId: connection.workspaceId,
      teamId,
      slackUserId,
    });
    if (linked) {
      return ephemeral(
        "Your Slack account is already linked. Use `/margaya unlink` to disconnect it.",
      );
    }
    return linkPromptMessage(
      linkUrl(connection, teamId, slackUserId, actor.userName),
    );
  }

  if (verb === "unlink") {
    const removed = await unlinkSlackIdentity({
      workspaceId: connection.workspaceId,
      teamId,
      slackUserId,
    });
    return ephemeral(
      removed
        ? "Unlinked. Slack no longer acts as your Margaya account."
        : "Your Slack account wasn't linked.",
    );
  }

  const outcome = await asActor(connection, actor, async (api) => {
    if (verb === "add" || verb === "new" || verb === "capture") {
      if (!rest) return ephemeral("Add a title: `/margaya add Fix the login`.");
      const result = await captureTask(api, {
        workspaceId: connection.workspaceId,
        defaultProjectId: connection.defaultProjectId,
        text: rest,
        today,
      });
      return result.ok
        ? ephemeral(result.message, [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: result.url
                  ? `${escapeSlack(result.message)} <${result.url}|Open>`
                  : escapeSlack(result.message),
              },
            },
          ])
        : ephemeral(result.message);
    }

    if (TASK_KEY_PATTERN.test(text)) {
      const preview = await loadTaskPreview(api, connection.workspaceId, {
        key: text,
      });
      return preview
        ? ephemeral(`${preview.key} ${preview.title}`, [
            ...taskPreviewBlocks(preview, { actions: true }),
          ])
        : ephemeral(`No task ${text} that you can see.`);
    }

    const query = verb === "search" || verb === "find" ? rest : text;
    if (!query) return ephemeral("What should I search for?");
    const hits = await searchTasks(api, connection.workspaceId, query);
    if (!hits) return ephemeral("Search failed. Try again in a moment.");
    if (hits.length === 0) {
      return ephemeral(`No tasks you can see match "${truncate(query, 80)}".`);
    }
    const lines = hits.map(
      (hit) =>
        `• <${hit.url}|${escapeSlack(hit.key ? `${hit.key} ` : "")}${escapeSlack(truncate(hit.title, 120))}>${
          hit.projectName ? ` · ${escapeSlack(hit.projectName)}` : ""
        }`,
    );
    return ephemeral(`${hits.length} tasks found`, [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Tasks matching "${escapeSlack(truncate(query, 80))}"*\n${lines.join("\n")}`,
        },
      },
    ]);
  });

  if (!outcome.linked) {
    return linkPromptMessage(
      linkUrl(connection, teamId, slackUserId, actor.userName),
    );
  }
  return outcome.value;
}

// ------------------------------------------------------------ interactions

function actorOf(payload: Json): Actor | null {
  const user = obj(payload.user);
  const teamId = str(obj(payload.team).id) ?? str(user.team_id);
  const slackUserId = str(user.id);
  if (!teamId || !slackUserId) return null;
  return {
    teamId,
    slackUserId,
    userName: str(user.username) ?? str(user.name),
  };
}

async function handleBlockAction(
  connection: LoadedSlackConnection,
  payload: Json,
  actor: Actor,
): Promise<void> {
  const action = obj(
    Array.isArray(payload.actions) ? payload.actions[0] : null,
  );
  const actionId = str(action.action_id);
  const responseUrl = payload.response_url;
  if (actionId !== ACTION_ASSIGN_ME && actionId !== ACTION_SET_STATUS) return;

  const outcome = await asActor(connection, actor, async (api, userId) => {
    if (actionId === ACTION_ASSIGN_ME) {
      const taskId = str(action.value);
      if (!taskId) return null;
      return assignToMe(api, taskId, userId);
    }
    const parsed = parseStatusValue(obj(action.selected_option).value);
    if (!parsed) return null;
    return changeStatus(api, parsed.taskId, parsed.status);
  });

  if (!outcome.linked) {
    await respondToSlack(
      responseUrl,
      linkPromptMessage(
        linkUrl(connection, actor.teamId, actor.slackUserId, actor.userName),
      ),
    );
    return;
  }
  if (outcome.value) {
    await respondToSlack(responseUrl, { text: outcome.value.message });
  }
}

export function createTaskModal(input: {
  title: string;
  description: string;
  projects: Array<{ id: string; name: string; intakeEnabled?: boolean }>;
  defaultProjectId: string | null;
}): Json {
  const options = input.projects.slice(0, 100).map((project) => ({
    text: { type: "plain_text", text: truncate(project.name, 75) },
    value: project.id,
  }));
  const initial = options.find(
    (option) => option.value === input.defaultProjectId,
  );
  const intakeOption = {
    text: { type: "plain_text", text: "Send to intake for review" },
    description: {
      type: "plain_text",
      text: "Needs Intake on in the project",
    },
    value: "intake",
  };
  return {
    type: "modal",
    callback_id: MODAL_CREATE_TASK,
    title: { type: "plain_text", text: "Create Margaya task" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title",
        label: { type: "plain_text", text: "Title" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          max_length: 500,
          initial_value: truncate(input.title, 500),
        },
      },
      {
        type: "input",
        block_id: "project",
        label: { type: "plain_text", text: "Project" },
        element: {
          type: "static_select",
          action_id: "value",
          options,
          ...(initial ? { initial_option: initial } : {}),
        },
      },
      {
        type: "input",
        block_id: "description",
        optional: true,
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 3000,
          initial_value: truncate(input.description, 3000),
        },
      },
      {
        type: "input",
        block_id: "intake",
        optional: true,
        label: { type: "plain_text", text: "Intake" },
        element: {
          type: "checkboxes",
          action_id: "value",
          options: [intakeOption],
        },
      },
    ],
  };
}

async function handleMessageShortcut(
  connection: LoadedSlackConnection,
  payload: Json,
  actor: Actor,
): Promise<void> {
  const triggerId = str(payload.trigger_id);
  const message = obj(payload.message);
  const channelId = str(obj(payload.channel).id);
  const messageTs = str(message.ts) ?? str(payload.message_ts);
  if (!triggerId) return;

  const outcome = await asActor(connection, actor, async (api) =>
    listProjects(api, connection.workspaceId),
  );
  if (!outcome.linked) {
    await respondToSlack(
      payload.response_url,
      linkPromptMessage(
        linkUrl(connection, actor.teamId, actor.slackUserId, actor.userName),
      ),
    );
    return;
  }
  const projects = outcome.value;
  if (projects.length === 0) {
    await respondToSlack(payload.response_url, {
      text: "You can't see any projects in this Margaya workspace.",
    });
    return;
  }

  let permalink: string | null = null;
  if (channelId && messageTs) {
    try {
      const result = await callSlack<{ permalink?: string }>(
        connection.botToken,
        "chat.getPermalink",
        { channel: channelId, message_ts: messageTs },
      );
      permalink = str(result.permalink);
    } catch {
      // A channel the bot can't read: the task still gets the text.
    }
  }

  const text = str(message.text) ?? "";
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  await callSlack(connection.botToken, "views.open", {
    trigger_id: triggerId,
    view: createTaskModal({
      title: firstLine
        .replace(/<[^>]*\|([^>]+)>/g, "$1")
        .replace(/<[^>]+>/g, ""),
      description: messageDescription(text, permalink),
      projects,
      defaultProjectId: connection.defaultProjectId,
    }),
  });
}

function stateValue(state: Json, block: string): Json {
  return obj(obj(obj(state.values)[block]).value);
}

function resultView(text: string, url?: string): Json {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Create Margaya task" },
    close: { type: "plain_text", text: "Done" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: url
            ? `${escapeSlack(text)} <${url}|Open in Margaya>`
            : escapeSlack(text),
        },
      },
    ],
  };
}

async function handleModalSubmit(
  connection: LoadedSlackConnection,
  payload: Json,
  actor: Actor,
): Promise<unknown> {
  const view = obj(payload.view);
  const state = obj(view.state);
  const title = str(stateValue(state, "title").value) ?? "";
  const projectId = str(
    obj(stateValue(state, "project").selected_option).value,
  );
  const description = str(stateValue(state, "description").value) ?? "";
  const selected = stateValue(state, "intake").selected_options;
  const toIntake =
    Array.isArray(selected) &&
    selected.some((option) => obj(option).value === "intake");
  if (!title.trim()) {
    return {
      response_action: "errors",
      errors: { title: "Give the task a title." },
    };
  }
  if (!projectId) {
    return {
      response_action: "errors",
      errors: { project: "Choose a project." },
    };
  }
  const outcome = await asActor(connection, actor, (api) =>
    createTaskFromMessage(api, {
      workspaceId: connection.workspaceId,
      projectId,
      title,
      description,
      toIntake,
    }),
  );
  if (!outcome.linked) {
    return {
      response_action: "update",
      view: resultView(
        "Your Slack account isn't linked to Margaya any more. Run /margaya link.",
      ),
    };
  }
  if (!outcome.value.ok) {
    return {
      response_action: "errors",
      errors: { [toIntake ? "intake" : "project"]: outcome.value.message },
    };
  }
  return {
    response_action: "update",
    view: resultView(outcome.value.message, outcome.value.url),
  };
}

export async function handleInteractive(
  connection: LoadedSlackConnection,
  payload: Json,
): Promise<InboundResult> {
  const actor = actorOf(payload);
  if (!actor || !teamMatches(connection, actor.teamId)) return {};
  const type = str(payload.type);

  if (type === "block_actions") {
    background("block action", () =>
      handleBlockAction(connection, payload, actor),
    );
    return {};
  }
  if (
    (type === "message_action" || type === "shortcut") &&
    str(payload.callback_id) === SHORTCUT_CREATE_TASK
  ) {
    background("message shortcut", () =>
      handleMessageShortcut(connection, payload, actor),
    );
    return {};
  }
  if (
    type === "view_submission" &&
    str(obj(payload.view).callback_id) === MODAL_CREATE_TASK
  ) {
    return { body: await handleModalSubmit(connection, payload, actor) };
  }
  return {};
}

// ------------------------------------------------------------------ events

/** The task a Margaya link points at, for links into this workspace only. */
export function taskRefFromUrl(
  rawUrl: string,
  workspaceId: string,
  webUrl = publicWebUrl(),
): TaskRef | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(rawUrl);
    base = new URL(webUrl);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!url.pathname.startsWith(`${basePath}/`)) return null;
  const path = url.pathname.slice(basePath.length);
  const byId =
    /^\/dashboard\/workspace\/([^/]+)\/project\/[^/]+\/task\/([^/]+)\/?$/.exec(
      path,
    );
  const byKey = /^\/dashboard\/workspace\/([^/]+)\/task\/([^/]+)\/?$/.exec(
    path,
  );
  const searchTask = url.searchParams.get("taskId");
  const onBoard = /^\/dashboard\/workspace\/([^/]+)\/project\/[^/]+\//.exec(
    path,
  );
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  if (byId && decode(byId[1] ?? "") === workspaceId) {
    return { taskId: decode(byId[2] ?? "") };
  }
  if (byKey && decode(byKey[1] ?? "") === workspaceId) {
    const key = decode(byKey[2] ?? "");
    return TASK_KEY_PATTERN.test(key) ? { key } : null;
  }
  if (onBoard && searchTask && decode(onBoard[1] ?? "") === workspaceId) {
    return { taskId: searchTask };
  }
  return null;
}

/** Task keys typed in a message, outside links and code. At most three. */
export function taskKeysIn(text: string): string[] {
  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  const keys = new Set<string>();
  for (const match of plain.matchAll(
    /(?<![\w/-])([A-Z][A-Z0-9]{0,15}-\d{1,9})(?![\w-])/g,
  )) {
    keys.add(match[1] as string);
    if (keys.size >= 3) break;
  }
  return [...keys];
}

async function handleLinkShared(
  connection: LoadedSlackConnection,
  teamId: string,
  event: Json,
): Promise<void> {
  const slackUserId = str(event.user);
  const links = Array.isArray(event.links) ? event.links.slice(0, 5) : [];
  if (!slackUserId || links.length === 0) return;
  const refs = links
    .map((link) => str(obj(link).url))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({ url, ref: taskRefFromUrl(url, connection.workspaceId) }))
    .filter((entry): entry is { url: string; ref: TaskRef } =>
      Boolean(entry.ref),
    );
  if (refs.length === 0) return;

  // The poster's rights decide; an unlinked poster or a task they can't see
  // gets no preview at all.
  const outcome = await asActor(
    connection,
    { teamId, slackUserId, userName: null },
    async (api) => {
      const unfurls: Record<string, { blocks: SlackBlock[] }> = {};
      for (const { url, ref } of refs) {
        const preview = await loadTaskPreview(api, connection.workspaceId, ref);
        if (preview) unfurls[url] = { blocks: taskPreviewBlocks(preview) };
      }
      return unfurls;
    },
  );
  if (!outcome.linked || Object.keys(outcome.value).length === 0) return;
  const unfurlId = str(event.unfurl_id);
  const source = str(event.source);
  await callSlack(connection.botToken, "chat.unfurl", {
    ...(unfurlId && source
      ? { unfurl_id: unfurlId, source }
      : { channel: str(event.channel), ts: str(event.message_ts) }),
    unfurls: outcome.value,
  });
}

async function handleMessageEvent(
  connection: LoadedSlackConnection,
  teamId: string,
  event: Json,
): Promise<void> {
  if (!connection.expandTaskKeys) return;
  // Edits, joins, bot posts (ours included) and hidden events are skipped.
  if (event.subtype || event.bot_id || event.hidden) return;
  const slackUserId = str(event.user);
  const channel = str(event.channel);
  const ts = str(event.ts);
  const text = str(event.text);
  if (!slackUserId || !channel || !ts || !text) return;
  if (slackUserId === connection.botUserId) return;
  const keys = taskKeysIn(text);
  if (keys.length === 0) return;

  const outcome = await asActor(
    connection,
    { teamId, slackUserId, userName: null },
    async (api) => {
      const blocks: SlackBlock[] = [];
      const names: string[] = [];
      for (const key of keys) {
        const preview = await loadTaskPreview(api, connection.workspaceId, {
          key,
        });
        if (!preview) continue;
        if (blocks.length > 0) blocks.push({ type: "divider" });
        blocks.push(...taskPreviewBlocks(preview));
        names.push(`${preview.key} ${preview.title}`);
      }
      return { blocks, names };
    },
  );
  if (!outcome.linked || outcome.value.blocks.length === 0) return;
  await callSlack(connection.botToken, "chat.postMessage", {
    channel,
    thread_ts: str(event.thread_ts) ?? ts,
    text: truncate(outcome.value.names.join(", "), 300),
    blocks: outcome.value.blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
}

export async function handleEvent(
  connection: LoadedSlackConnection,
  payload: Json,
): Promise<InboundResult> {
  if (str(payload.type) !== "event_callback") return {};
  const teamId = str(payload.team_id);
  if (!teamMatches(connection, teamId) || !teamId) return {};
  const event = obj(payload.event);
  const type = str(event.type);
  if (type === "link_shared") {
    background("unfurl", () => handleLinkShared(connection, teamId, event));
  } else if (type === "message") {
    background("task key preview", () =>
      handleMessageEvent(connection, teamId, event),
    );
  }
  return {};
}

export async function handleInbound(
  connection: LoadedSlackConnection,
  inbound: SlackInbound,
): Promise<InboundResult> {
  try {
    if (inbound.kind === "command") {
      return { body: await handleCommand(connection, inbound.payload) };
    }
    if (inbound.kind === "interactive") {
      return await handleInteractive(connection, inbound.payload);
    }
    return await handleEvent(connection, inbound.payload);
  } catch (error) {
    logFailure(inbound.kind, error);
    return inbound.kind === "command"
      ? { body: ephemeral("Something went wrong in Margaya. Try again.") }
      : {};
  }
}
