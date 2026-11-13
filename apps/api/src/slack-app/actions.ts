import { publicWebUrl } from "../utils/desktop-config";
import type { UserApi } from "./acting-user";
import type { StatusOption, TaskPreview } from "./blocks";
import { sentenceCase } from "./blocks";
import { dueDateToIso, parseCapture } from "./capture-parser";

// What Slack can do, expressed as calls to the API's own routes with the
// linked user's one-action key (acting-user.ts). Nothing here reads the
// database for workspace content: the API decides what the user may see.

type ProjectJson = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  archivedAt?: string | null;
  intakeEnabled?: boolean;
};
type ColumnJson = {
  slug: string;
  name: string;
  group: string;
  isFinal: boolean;
};
type TaskJson = {
  id: string;
  projectId: string;
  number: number | null;
  title: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  assignees?: Array<{ name?: string | null }>;
};

const enc = encodeURIComponent;

export function taskUrl(workspaceId: string, projectId: string, id: string) {
  return `${publicWebUrl()}/dashboard/workspace/${enc(workspaceId)}/project/${enc(projectId)}/task/${enc(id)}`;
}

export async function listProjects(
  api: UserApi,
  workspaceId: string,
): Promise<ProjectJson[]> {
  const result = await api<ProjectJson[]>(
    "GET",
    `/project?workspaceId=${enc(workspaceId)}`,
  );
  return result.ok ? result.data.filter((project) => !project.archivedAt) : [];
}

export async function listStatuses(
  api: UserApi,
  projectId: string,
): Promise<StatusOption[]> {
  const result = await api<ColumnJson[]>("GET", `/column/${enc(projectId)}`);
  if (!result.ok) return [];
  return result.data
    .filter((column) => column.group !== "triage")
    .map((column) => ({ slug: column.slug, name: column.name }));
}

/** The column a new task starts in: the first open "unstarted" one. */
async function defaultStatus(
  api: UserApi,
  projectId: string,
): Promise<string | null> {
  const result = await api<ColumnJson[]>("GET", `/column/${enc(projectId)}`);
  if (!result.ok) return null;
  const columns = result.data.filter((column) => column.group !== "triage");
  const open = columns.filter((column) => !column.isFinal);
  return (
    (
      open.find((column) => column.group === "unstarted") ??
      open.find((column) => column.group === "backlog") ??
      open[0] ??
      columns[0]
    )?.slug ?? null
  );
}

export type TaskRef = { taskId: string } | { key: string };

/**
 * A task preview the user may see, or null. A task outside the connection's
 * workspace is treated as invisible, so one Slack team never shows another
 * workspace's work even when the same person belongs to both.
 */
export async function loadTaskPreview(
  api: UserApi,
  workspaceId: string,
  ref: TaskRef,
): Promise<TaskPreview | null> {
  let taskId: string;
  if ("key" in ref) {
    const found = await api<{ id: string }>(
      "GET",
      `/task/by-key/${enc(workspaceId)}/${enc(ref.key)}`,
    );
    if (!found.ok) return null;
    taskId = found.data.id;
  } else {
    taskId = ref.taskId;
  }
  const task = await api<TaskJson>("GET", `/task/${enc(taskId)}`);
  if (!task.ok) return null;
  const project = await api<ProjectJson>(
    "GET",
    `/project/${enc(task.data.projectId)}`,
  );
  if (!project.ok || project.data.workspaceId !== workspaceId) return null;
  const statuses = await listStatuses(api, project.data.id);
  const key =
    task.data.number !== null
      ? `${project.data.slug.toUpperCase()}-${task.data.number}`
      : project.data.slug.toUpperCase();
  return {
    id: task.data.id,
    key,
    title: task.data.title,
    url: taskUrl(workspaceId, project.data.id, task.data.id),
    projectName: project.data.name,
    status: task.data.status,
    statusName:
      statuses.find((status) => status.slug === task.data.status)?.name ??
      sentenceCase(task.data.status),
    priority: task.data.priority,
    dueDate: task.data.dueDate,
    assigneeNames: (task.data.assignees ?? [])
      .map((assignee) => assignee.name ?? "")
      .filter(Boolean),
    statuses,
  };
}

export type SearchHit = {
  id: string;
  title: string;
  key: string | null;
  url: string;
  projectName: string | null;
};

export async function searchTasks(
  api: UserApi,
  workspaceId: string,
  query: string,
): Promise<SearchHit[] | null> {
  const params = new URLSearchParams({
    q: query.slice(0, 512),
    type: "tasks",
    workspaceId,
    limit: "8",
  });
  const result = await api<{
    results: Array<{
      id: string;
      type: string;
      title: string;
      projectId?: string;
      projectName?: string;
      projectSlug?: string;
      taskNumber?: number;
    }>;
  }>("GET", `/search?${params}`);
  if (!result.ok) return null;
  return result.data.results
    .filter((hit) => hit.type === "task" && hit.projectId)
    .map((hit) => ({
      id: hit.id,
      title: hit.title,
      key:
        hit.projectSlug && hit.taskNumber !== undefined
          ? `${hit.projectSlug.toUpperCase()}-${hit.taskNumber}`
          : null,
      url: taskUrl(workspaceId, hit.projectId as string, hit.id),
      projectName: hit.projectName ?? null,
    }));
}

export type ActionOutcome =
  | { ok: true; message: string; url?: string }
  | { ok: false; message: string };

function failure(status: number, message: string): ActionOutcome {
  if (status === 403) {
    return {
      ok: false,
      message: `Your Margaya account isn't allowed to do that (${message}).`,
    };
  }
  if (status === 404) {
    return { ok: false, message: "That isn't there, or you can't see it." };
  }
  return { ok: false, message: `Margaya said: ${message}` };
}

/**
 * Picks the target project of a capture: a leading project key ("WEB fix
 * login") among the projects the user can see, else the default project.
 */
export function pickCaptureProject(
  text: string,
  projects: readonly ProjectJson[],
  defaultProjectId: string | null,
): { project: ProjectJson | null; rest: string } {
  const trimmed = text.trim();
  const [first, ...others] = trimmed.split(/\s+/);
  const byKey = first
    ? projects.find(
        (project) => project.slug.toLowerCase() === first.toLowerCase(),
      )
    : undefined;
  if (byKey && others.length > 0) {
    return { project: byKey, rest: others.join(" ") };
  }
  return {
    project:
      projects.find((project) => project.id === defaultProjectId) ?? null,
    rest: trimmed,
  };
}

/** `/margaya add …`: the capture bar's tokens, created as the user. */
export async function captureTask(
  api: UserApi,
  input: {
    workspaceId: string;
    defaultProjectId: string | null;
    text: string;
    today?: Date;
  },
): Promise<ActionOutcome> {
  const projects = await listProjects(api, input.workspaceId);
  const { project, rest } = pickCaptureProject(
    input.text,
    projects,
    input.defaultProjectId,
  );
  if (!project) {
    return {
      ok: false,
      message:
        "Start with a project key (for example `/margaya add WEB Fix the login`). This workspace has no default project for Slack.",
    };
  }
  const [members, labels] = await Promise.all([
    api<Array<{ id: string; name: string }>>(
      "GET",
      `/workspace/${enc(input.workspaceId)}/members`,
    ),
    api<Array<{ name: string; color: string }>>(
      "GET",
      `/label/workspace/${enc(input.workspaceId)}`,
    ),
  ]);
  const parsed = parseCapture(rest, {
    members: members.ok ? members.data : [],
    labels: labels.ok ? labels.data : [],
    // A label that doesn't exist yet is created only through the API, which
    // checks label:create itself.
    allowNewLabels: true,
    today: input.today ?? new Date(),
  });
  if (!parsed.title) {
    return { ok: false, message: "The task needs a title." };
  }
  const status = await defaultStatus(api, project.id);
  if (!status) return { ok: false, message: "The project has no columns." };
  const created = await api<TaskJson>("POST", `/task/${enc(project.id)}`, {
    title: parsed.title.slice(0, 500),
    description: "",
    status,
    ...(parsed.assigneeIds.length > 0
      ? { assigneeIds: parsed.assigneeIds }
      : {}),
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    ...(parsed.dueDate ? { dueDate: dueDateToIso(parsed.dueDate) } : {}),
  });
  if (!created.ok) return failure(created.status, created.message);
  const failedLabels: string[] = [];
  for (const label of parsed.labels) {
    const added = await api("POST", "/label", {
      name: label.name,
      color: label.color,
      workspaceId: input.workspaceId,
      taskId: created.data.id,
    });
    if (!added.ok) failedLabels.push(label.name);
  }
  const key =
    created.data.number !== null
      ? `${project.slug.toUpperCase()}-${created.data.number}`
      : project.slug.toUpperCase();
  return {
    ok: true,
    message: `Created ${key} ${parsed.title} in ${project.name}.${
      failedLabels.length > 0
        ? ` Couldn't add: ${failedLabels.map((name) => `#${name}`).join(", ")}.`
        : ""
    }`,
    url: taskUrl(input.workspaceId, project.id, created.data.id),
  };
}

/** The message shortcut: a task, or a request in the project's intake. */
export async function createTaskFromMessage(
  api: UserApi,
  input: {
    workspaceId: string;
    projectId: string;
    title: string;
    description: string;
    toIntake: boolean;
  },
): Promise<ActionOutcome> {
  const title = input.title.trim().slice(0, 500);
  if (!title) return { ok: false, message: "The task needs a title." };
  const project = await api<ProjectJson>(
    "GET",
    `/project/${enc(input.projectId)}`,
  );
  if (!project.ok || project.data.workspaceId !== input.workspaceId) {
    return failure(404, "not found");
  }
  if (input.toIntake) {
    const created = await api<{ taskId?: string; id: string }>(
      "POST",
      `/intake/project/${enc(input.projectId)}`,
      { title, description: input.description },
    );
    if (!created.ok) return failure(created.status, created.message);
    return {
      ok: true,
      message: `Sent to ${project.data.name}'s intake for review.`,
    };
  }
  const status = await defaultStatus(api, input.projectId);
  if (!status) return { ok: false, message: "The project has no columns." };
  const created = await api<TaskJson>("POST", `/task/${enc(input.projectId)}`, {
    title,
    description: input.description,
    status,
  });
  if (!created.ok) return failure(created.status, created.message);
  const key =
    created.data.number !== null
      ? `${project.data.slug.toUpperCase()}-${created.data.number}`
      : "";
  return {
    ok: true,
    message: `Created ${key} ${title} in ${project.data.name}.`.replace(
      /\s+/g,
      " ",
    ),
    url: taskUrl(input.workspaceId, input.projectId, created.data.id),
  };
}

export async function assignToMe(
  api: UserApi,
  taskId: string,
  userId: string,
): Promise<ActionOutcome> {
  const result = await api("PATCH", `/task/assignees/${enc(taskId)}`, {
    add: [userId],
  });
  if (!result.ok) return failure(result.status, result.message);
  return { ok: true, message: "Assigned to you." };
}

export async function changeStatus(
  api: UserApi,
  taskId: string,
  status: string,
): Promise<ActionOutcome> {
  const result = await api("PUT", `/task/status/${enc(taskId)}`, { status });
  if (!result.ok) return failure(result.status, result.message);
  return { ok: true, message: "Status changed." };
}

/** Slack mrkdwn to the Markdown task descriptions use. */
export function slackTextToMarkdown(text: string): string {
  return text
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "[$2]($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_m, id: string, name?: string) =>
      name ? `@${name.slice(1)}` : `@${id}`,
    )
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function messageDescription(
  text: string,
  permalink: string | null,
): string {
  const quoted = slackTextToMarkdown(text)
    .slice(0, 4000)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return permalink
    ? `${quoted}\n\nFrom Slack: [view the message](${permalink})`
    : `${quoted}\n\nFrom Slack.`;
}
