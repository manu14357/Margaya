import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { InternalApi, InternalResult } from "../ai-build/dispatch";
import { openSecret, sealSecret } from "../utils/secret-box";
import type { PlanFacts } from "./facts";
import type { ActionParams, ChatBuildAction, RefKind } from "./schema";
import { NEW_PROJECT_STATUSES } from "./validate";

// Applies checked actions one by one through the API's own routes with the
// caller's credentials (ai-build/dispatch.ts): authorization, validation,
// events, activity, WebSockets and webhooks behave exactly as if the person
// had clicked through it. A failed action doesn't stop the plan; actions
// that depend on it (through temp refs) are skipped.
//
// Undo needs no table: each applied action gets a sealed token (AES-GCM,
// keyed from AUTH_SECRET) holding the inverse operation, its owner, its
// workspace and an expiry one hour out. Undoing replays the inverse through
// the same routes, again with the caller's own rights.

export type ActionResult = {
  actionId: string;
  ok: boolean;
  url?: string;
  label?: string;
  error?: string;
  skipped?: boolean;
  undoToken?: string;
  runId?: string;
};

type Created = { kind: RefKind; id: string; projectId: string; key?: string };

type CreatedProject = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  isPublic?: boolean | null;
};

type Undo =
  | { op: "delete_project"; id: string }
  | { op: "delete_task"; id: string }
  | { op: "delete_cycle"; id: string }
  | { op: "delete_module"; id: string }
  | { op: "delete_comment"; id: string }
  | { op: "delete_relation"; id: string }
  | { op: "delete_label"; id: string }
  | { op: "archive_page"; id: string }
  | { op: "restore_task"; id: string }
  | { op: "task_fields"; id: string; before: TaskFields }
  | { op: "status"; id: string; before: string }
  | { op: "assignees"; id: string; before: string[] }
  | {
      op: "cycle_tasks";
      id: string;
      added: string[];
      moved: { taskId: string; fromCycleId: string }[];
    }
  | { op: "module_tasks"; id: string; added: string[] };

type TaskFields = {
  title?: string;
  description?: string;
  priority?: string;
  dueDate?: string | null;
};

type UndoClaims = {
  v: 1;
  userId: string;
  workspaceId: string;
  exp: number;
  undo: Undo;
};

const UNDO_PURPOSE = "ai-chat-build-undo";
export const UNDO_TTL_MS = 60 * 60 * 1000;
// A token carries the old values (a long description); past this it is
// not offered rather than becoming an unwieldy request.
const MAX_TOKEN_CHARS = 64_000;
const MAX_KEY_ATTEMPTS = 5;

export function sealUndo(
  claims: Omit<UndoClaims, "v" | "exp">,
  now = Date.now(),
): string | undefined {
  const token = sealSecret(
    UNDO_PURPOSE,
    JSON.stringify({ v: 1, exp: now + UNDO_TTL_MS, ...claims }),
  );
  return token.length <= MAX_TOKEN_CHARS ? token : undefined;
}

export function openUndo(token: string): UndoClaims | null {
  try {
    const claims = JSON.parse(openSecret(UNDO_PURPOSE, token)) as UndoClaims;
    return claims?.v === 1 && claims.undo ? claims : null;
  } catch {
    return null;
  }
}

// Undone tokens, so the same one can't be replayed by this process. Best
// effort across instances: replaying an undo there fails on its own for
// deletions and is harmless for the rest (it sets the old values again).
const spent = new Map<string, number>();

function spentKey(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function sweepSpent(now: number) {
  for (const [key, exp] of spent) if (exp <= now) spent.delete(key);
}

const enc = encodeURIComponent;

class ActionFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function must<T>(result: InternalResult<T>): T {
  if (!result.ok) throw new ActionFailed(result.message, result.status);
  return result.data;
}

/** The due-date route takes an instant; a calendar day means its noon UTC. */
function dueInstant(day: string) {
  return `${day}T12:00:00.000Z`;
}

function dayOf(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10
    ? value.slice(0, 10)
    : null;
}

const paths = {
  project: (w: string, p: string) =>
    `/dashboard/workspace/${w}/project/${p}/board`,
  task: (w: string, p: string, t: string) =>
    `/dashboard/workspace/${w}/project/${p}/task/${t}`,
  cycle: (w: string, p: string, c: string) =>
    `/dashboard/workspace/${w}/project/${p}/cycles/${c}`,
  module: (w: string, p: string, m: string) =>
    `/dashboard/workspace/${w}/project/${p}/modules/${m}`,
  page: (w: string, p: string, id: string) =>
    `/dashboard/workspace/${w}/project/${p}/pages/${id}`,
  run: (w: string, runId: string) =>
    `/dashboard/workspace/${w}/agents?runId=${enc(runId)}`,
};

type TaskSnapshot = {
  id: string;
  projectId: string;
  number: number | null;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  dueDate: string | null;
  assigneeIds?: string[];
};

/** Every temp ref an action points at. */
export function refsOf(action: ChatBuildAction): string[] {
  const params = action.params as Record<string, unknown>;
  const out: string[] = [];
  for (const key of [
    "projectRef",
    "taskRef",
    "targetRef",
    "parentRef",
    "cycleRef",
    "moduleRef",
  ]) {
    if (typeof params[key] === "string") out.push(params[key] as string);
  }
  if (Array.isArray(params.taskRefs)) {
    out.push(
      ...params.taskRefs.filter((v): v is string => typeof v === "string"),
    );
  }
  return out;
}

export async function applyActions(input: {
  call: InternalApi;
  workspaceId: string;
  userId: string;
  facts: PlanFacts;
  actions: readonly ChatBuildAction[];
  /** Destructive actions the person ticked. */
  confirmed: ReadonlySet<string>;
}): Promise<ActionResult[]> {
  const { call, workspaceId, facts } = input;
  const created = new Map<string, Created>();
  const results: ActionResult[] = [];
  const projectKey = (projectId: string) =>
    [...created.values()].find(
      (item) => item.kind === "project" && item.id === projectId,
    )?.key ?? facts.projects.find((p) => p.id === projectId)?.key;
  const taskLabel = (task: {
    number: number | null;
    title: string;
    projectId: string;
  }) => {
    const key = projectKey(task.projectId);
    return key && task.number !== null
      ? `${key}-${task.number} ${task.title}`
      : task.title;
  };
  const getTask = (id: string) =>
    call<TaskSnapshot>("GET", `/task/${enc(id)}`).then(must);
  const ref = (value: unknown): Created | undefined =>
    typeof value === "string" ? created.get(value) : undefined;
  const projectOf = (params: { projectId?: string; projectRef?: string }) =>
    params.projectId ?? ref(params.projectRef)?.id ?? "";
  const taskIdOf = (params: { taskId?: string; taskRef?: string }) =>
    params.taskId ?? ref(params.taskRef)?.id ?? "";
  const seal = (undo: Undo) =>
    sealUndo({ userId: input.userId, workspaceId, undo });

  for (const action of input.actions) {
    const base = { actionId: action.id };
    if (action.problem) {
      results.push({
        ...base,
        ok: false,
        skipped: true,
        error: action.problem.message,
      });
      continue;
    }
    if (action.risk === "destructive" && !input.confirmed.has(action.id)) {
      results.push({
        ...base,
        ok: false,
        skipped: true,
        error: "Not confirmed",
      });
      continue;
    }
    const missing = refsOf(action).filter((value) => !created.has(value));
    if (missing.length > 0) {
      results.push({
        ...base,
        ok: false,
        skipped: true,
        error: "Skipped: an action it depends on did not go through",
      });
      continue;
    }

    try {
      const result = await applyOne(action);
      results.push({ ...base, ok: true, ...result });
    } catch (error) {
      const message =
        error instanceof ActionFailed
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed";
      if (!(error instanceof ActionFailed)) {
        console.error("ai chat build: action failed", {
          op: action.op,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
      results.push({ ...base, ok: false, error: message.slice(0, 300) });
    }
  }
  return results;

  async function applyOne(
    action: ChatBuildAction,
  ): Promise<Omit<ActionResult, "actionId" | "ok">> {
    const tempId = action.refs?.tempId;
    switch (action.op) {
      case "create_project": {
        const params = action.params as ActionParams<"create_project">;
        const wanted = params.key ?? keyFrom(params.name);
        let project: CreatedProject | null = null;
        let last: InternalResult<CreatedProject> | null = null;
        for (
          let attempt = 0;
          attempt < MAX_KEY_ATTEMPTS && !project;
          attempt++
        ) {
          // Keys are unique per workspace: KEY, KEY2, KEY3, ...
          const slug =
            attempt === 0
              ? wanted
              : `${[...wanted].slice(0, 7).join("")}${attempt + 1}`;
          const response: InternalResult<CreatedProject> =
            await call<CreatedProject>("POST", "/project", {
              name: params.name,
              workspaceId,
              icon: "Layout",
              slug,
            });
          last = response;
          if (response.ok) project = response.data;
          else if (response.status !== 409) break;
        }
        if (!project) {
          throw new ActionFailed(
            last && !last.ok ? last.message : "Project not created",
            last?.status ?? 500,
          );
        }
        const key = project.slug.toUpperCase();
        if (tempId) {
          created.set(tempId, {
            kind: "project",
            id: project.id,
            projectId: project.id,
            key,
          });
        }
        let error: string | undefined;
        if (params.description || params.leadUserId) {
          // The create route takes neither; the update route does.
          const updated = await call("PUT", `/project/${enc(project.id)}`, {
            name: project.name,
            icon: project.icon ?? "Layout",
            slug: project.slug,
            description: params.description ?? "",
            isPublic: project.isPublic ?? false,
            ...(params.leadUserId ? { leadUserId: params.leadUserId } : {}),
          });
          if (!updated.ok) {
            error = `Created, but its description and lead were not saved: ${updated.message}`;
          }
        }
        return {
          url: paths.project(workspaceId, project.id),
          label: `${key} ${project.name}`,
          undoToken: seal({ op: "delete_project", id: project.id }),
          ...(error ? { error } : {}),
        };
      }

      case "create_task": {
        const params = action.params as ActionParams<"create_task">;
        const projectId = projectOf(params);
        const fresh = Boolean(params.projectRef);
        const status =
          params.status ??
          (fresh
            ? NEW_PROJECT_STATUSES[0].slug
            : (facts.projects.find((p) => p.id === projectId)?.columns[0]
                ?.slug ?? "to-do"));
        const parentId = params.parentTaskId ?? ref(params.parentRef)?.id;
        const task = must(
          await call<{ id: string; number: number | null; title: string }>(
            "POST",
            `/task/${enc(projectId)}`,
            {
              title: params.title,
              description: params.description ?? "",
              // The model wrote the task: it carries the AI-generated label.
              aiAssist: { feature: "build_chat" },
              priority: params.priority ?? "no-priority",
              status,
              ...(params.assigneeIds
                ? { assigneeIds: params.assigneeIds }
                : {}),
              ...(params.dueDate
                ? { dueDate: dueInstant(params.dueDate) }
                : {}),
              ...(parentId ? { parentId } : {}),
            },
          ),
        );
        if (tempId)
          created.set(tempId, { kind: "task", id: task.id, projectId });
        const failedLabels: string[] = [];
        for (const name of params.labels ?? []) {
          const color =
            facts.labels.find(
              (l) => l.name.toLowerCase() === name.toLowerCase(),
            )?.color ?? "gray";
          const label = await call("POST", "/label", {
            name,
            color,
            workspaceId,
            taskId: task.id,
          });
          if (!label.ok) failedLabels.push(name);
        }
        return {
          url: paths.task(workspaceId, projectId, task.id),
          label: taskLabel({ ...task, projectId }),
          undoToken: seal({ op: "delete_task", id: task.id }),
          ...(failedLabels.length > 0
            ? {
                error: `Created, but these labels were not added: ${failedLabels.join(", ")}`,
              }
            : {}),
        };
      }

      case "update_task": {
        const params = action.params as ActionParams<"update_task">;
        const taskId = taskIdOf(params);
        const before = await getTask(taskId);
        const fields = params.fields;
        const previous: TaskFields = {};
        if (fields.title !== undefined) {
          previous.title = before.title;
          must(
            await call("PUT", `/task/title/${enc(taskId)}`, {
              title: fields.title,
            }),
          );
        }
        if (fields.priority !== undefined) {
          previous.priority = before.priority ?? "no-priority";
          must(
            await call("PUT", `/task/priority/${enc(taskId)}`, {
              priority: fields.priority,
            }),
          );
        }
        if (fields.dueDate !== undefined) {
          previous.dueDate = dayOf(before.dueDate);
          must(
            await call(
              "PUT",
              `/task/due-date/${enc(taskId)}`,
              fields.dueDate ? { dueDate: dueInstant(fields.dueDate) } : {},
            ),
          );
        }
        if (fields.description !== undefined) {
          previous.description = before.description ?? "";
          must(
            await call("PUT", `/task/description/${enc(taskId)}`, {
              description: fields.description,
              aiAssist: { feature: "build_chat" },
            }),
          );
        }
        return {
          url: paths.task(workspaceId, before.projectId, taskId),
          label: taskLabel({ ...before, title: fields.title ?? before.title }),
          undoToken: seal({ op: "task_fields", id: taskId, before: previous }),
        };
      }

      case "set_status": {
        const params = action.params as ActionParams<"set_status">;
        const taskId = taskIdOf(params);
        const before = await getTask(taskId);
        must(
          await call("PUT", `/task/status/${enc(taskId)}`, {
            status: params.status,
          }),
        );
        return {
          url: paths.task(workspaceId, before.projectId, taskId),
          label: taskLabel(before),
          undoToken: seal({ op: "status", id: taskId, before: before.status }),
        };
      }

      case "assign": {
        const params = action.params as ActionParams<"assign">;
        const taskId = taskIdOf(params);
        const before = await getTask(taskId);
        must(
          await call("PATCH", `/task/assignees/${enc(taskId)}`, {
            add: params.userIds,
          }),
        );
        return {
          url: paths.task(workspaceId, before.projectId, taskId),
          label: taskLabel(before),
          undoToken: seal({
            op: "assignees",
            id: taskId,
            before: before.assigneeIds ?? [],
          }),
        };
      }

      case "add_comment": {
        const params = action.params as ActionParams<"add_comment">;
        const taskId = taskIdOf(params);
        const comment = must(
          await call<{ id: string }>("POST", `/comment/${enc(taskId)}`, {
            content: params.content,
          }),
        );
        const task = await getTask(taskId).catch(() => null);
        return {
          ...(task
            ? {
                url: paths.task(workspaceId, task.projectId, taskId),
                label: taskLabel(task),
              }
            : {}),
          undoToken: seal({ op: "delete_comment", id: comment.id }),
        };
      }

      case "create_cycle": {
        const params = action.params as ActionParams<"create_cycle">;
        const projectId = projectOf(params);
        const cycle = must(
          await call<{ id: string; name: string }>(
            "POST",
            `/cycle/project/${enc(projectId)}`,
            {
              name: params.name,
              startDate: params.startDate ?? null,
              endDate: params.endDate ?? null,
            },
          ),
        );
        if (tempId)
          created.set(tempId, { kind: "cycle", id: cycle.id, projectId });
        return {
          url: paths.cycle(workspaceId, projectId, cycle.id),
          label: cycle.name,
          undoToken: seal({ op: "delete_cycle", id: cycle.id }),
        };
      }

      case "add_to_cycle": {
        const params = action.params as ActionParams<"add_to_cycle">;
        const cycleId = params.cycleId ?? ref(params.cycleRef)?.id ?? "";
        const taskIds = [
          ...(params.taskIds ?? []),
          ...(params.taskRefs ?? []).flatMap((r) => ref(r)?.id ?? []),
        ];
        const change = must(
          await call<{
            added: string[];
            moved: { taskId: string; fromCycleId: string }[];
          }>("POST", `/cycle/${enc(cycleId)}/tasks`, { taskIds }),
        );
        const projectId =
          facts.cycles.find((c) => c.id === cycleId)?.projectId ??
          ref(params.cycleRef)?.projectId;
        return {
          ...(projectId
            ? { url: paths.cycle(workspaceId, projectId, cycleId) }
            : {}),
          undoToken: seal({
            op: "cycle_tasks",
            id: cycleId,
            added: change.added ?? [],
            moved: change.moved ?? [],
          }),
        };
      }

      case "create_module": {
        const params = action.params as ActionParams<"create_module">;
        const projectId = projectOf(params);
        const module = must(
          await call<{ id: string; name: string }>(
            "POST",
            `/module/project/${enc(projectId)}`,
            {
              name: params.name,
              ...(params.description
                ? { description: params.description }
                : {}),
            },
          ),
        );
        if (tempId)
          created.set(tempId, { kind: "module", id: module.id, projectId });
        return {
          url: paths.module(workspaceId, projectId, module.id),
          label: module.name,
          undoToken: seal({ op: "delete_module", id: module.id }),
        };
      }

      case "add_to_module": {
        const params = action.params as ActionParams<"add_to_module">;
        const moduleId = params.moduleId ?? ref(params.moduleRef)?.id ?? "";
        const taskIds = [
          ...(params.taskIds ?? []),
          ...(params.taskRefs ?? []).flatMap((r) => ref(r)?.id ?? []),
        ];
        const change = must(
          await call<{ added: string[] }>(
            "POST",
            `/module/${enc(moduleId)}/tasks`,
            { taskIds },
          ),
        );
        const projectId =
          facts.modules.find((m) => m.id === moduleId)?.projectId ??
          ref(params.moduleRef)?.projectId;
        return {
          ...(projectId
            ? { url: paths.module(workspaceId, projectId, moduleId) }
            : {}),
          undoToken: seal({
            op: "module_tasks",
            id: moduleId,
            added: change.added ?? [],
          }),
        };
      }

      case "create_page": {
        const params = action.params as ActionParams<"create_page">;
        const projectId = projectOf(params);
        const page = must(
          await call<{ id: string; title: string | null }>(
            "POST",
            `/page/project/${enc(projectId)}`,
            { title: params.title, access: "public", content: params.content },
          ),
        );
        return {
          url: paths.page(workspaceId, projectId, page.id),
          label: page.title ?? params.title,
          undoToken: seal({ op: "archive_page", id: page.id }),
        };
      }

      case "link_tasks": {
        const params = action.params as ActionParams<"link_tasks">;
        const sourceTaskId = taskIdOf(params);
        const targetTaskId =
          params.targetTaskId ?? ref(params.targetRef)?.id ?? "";
        const relation = must(
          await call<{ id: string }>("POST", "/task-relation", {
            sourceTaskId,
            targetTaskId,
            relationType: params.relationType,
          }),
        );
        const task = await getTask(sourceTaskId).catch(() => null);
        return {
          ...(task
            ? {
                url: paths.task(workspaceId, task.projectId, sourceTaskId),
                label: taskLabel(task),
              }
            : {}),
          undoToken: seal({ op: "delete_relation", id: relation.id }),
        };
      }

      case "create_label": {
        const params = action.params as ActionParams<"create_label">;
        const label = must(
          await call<{ id: string; name: string }>("POST", "/label", {
            name: params.name,
            color: params.color,
            workspaceId,
          }),
        );
        return {
          label: label.name,
          undoToken: seal({ op: "delete_label", id: label.id }),
        };
      }

      case "delete_task": {
        const params = action.params as ActionParams<"delete_task">;
        const before = await getTask(params.taskId);
        must(await call("DELETE", `/task/${enc(params.taskId)}`));
        return {
          label: taskLabel(before),
          undoToken: seal({ op: "restore_task", id: params.taskId }),
        };
      }

      case "run_agent": {
        const params = action.params as ActionParams<"run_agent">;
        const run = must(
          await call<{ id: string; status: string }>(
            "POST",
            `/ai/agents/${enc(params.agentId)}/runs`,
            { workspaceId, taskId: taskIdOf(params), prompt: params.prompt },
          ),
        );
        return {
          url: paths.run(workspaceId, run.id),
          label: facts.agents.find((a) => a.id === params.agentId)?.name,
          runId: run.id,
        };
      }
    }
  }
}

function keyFrom(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const initials = words.map((word) => [...word][0]).join("");
  const key = initials.length >= 2 ? initials : [...(words[0] ?? "")].join("");
  return [...key].slice(0, 5).join("") || "NEW";
}

/** A deletion that falls back to archiving when the caller can't delete. */
async function removeOrArchive(
  call: InternalApi,
  remove: string,
  archive: { method: "POST" | "PUT"; path: string },
) {
  const removed = await call("DELETE", remove);
  if (removed.ok) return;
  if (removed.status !== 403) must(removed);
  must(await call(archive.method, archive.path));
}

/** Reverts one applied action; throws HTTPException on failure. */
export async function undoAction(input: {
  call: InternalApi;
  token: string;
  userId: string;
  workspaceId: string;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const claims = openUndo(input.token);
  // Someone else's token reads as an unknown one.
  if (
    !claims ||
    claims.userId !== input.userId ||
    claims.workspaceId !== input.workspaceId
  ) {
    throw new HTTPException(404, { message: "Nothing to undo" });
  }
  if (claims.exp <= now) {
    throw new HTTPException(410, { message: "Undo has expired" });
  }
  sweepSpent(now);
  const key = spentKey(input.token);
  if (spent.has(key)) {
    throw new HTTPException(409, { message: "Already undone" });
  }
  const { call } = input;
  const undo = claims.undo;
  try {
    switch (undo.op) {
      case "delete_project":
        await removeOrArchive(call, `/project/${enc(undo.id)}`, {
          method: "PUT",
          path: `/project/${enc(undo.id)}/archive`,
        });
        break;
      case "delete_task":
        await removeOrArchive(call, `/task/${enc(undo.id)}`, {
          method: "POST",
          path: `/task/archive/${enc(undo.id)}`,
        });
        break;
      case "delete_cycle":
        must(await call("DELETE", `/cycle/${enc(undo.id)}`));
        break;
      case "delete_module":
        must(await call("DELETE", `/module/${enc(undo.id)}`));
        break;
      case "delete_comment":
        must(await call("DELETE", `/comment/${enc(undo.id)}`));
        break;
      case "delete_relation":
        must(await call("DELETE", `/task-relation/${enc(undo.id)}`));
        break;
      case "delete_label":
        must(await call("DELETE", `/label/${enc(undo.id)}`));
        break;
      case "archive_page":
        must(await call("POST", `/page/${enc(undo.id)}/archive`));
        break;
      case "restore_task":
        must(await call("POST", `/trash/task/${enc(undo.id)}/restore`));
        break;
      case "status":
        must(
          await call("PUT", `/task/status/${enc(undo.id)}`, {
            status: undo.before,
          }),
        );
        break;
      case "assignees":
        must(
          await call("PUT", `/task/assignees/${enc(undo.id)}`, {
            assigneeIds: undo.before,
          }),
        );
        break;
      case "task_fields": {
        const { before } = undo;
        if (before.title !== undefined) {
          must(
            await call("PUT", `/task/title/${enc(undo.id)}`, {
              title: before.title,
            }),
          );
        }
        if (before.priority !== undefined) {
          must(
            await call("PUT", `/task/priority/${enc(undo.id)}`, {
              priority: before.priority,
            }),
          );
        }
        if (before.dueDate !== undefined) {
          must(
            await call(
              "PUT",
              `/task/due-date/${enc(undo.id)}`,
              before.dueDate ? { dueDate: dueInstant(before.dueDate) } : {},
            ),
          );
        }
        if (before.description !== undefined) {
          must(
            await call("PUT", `/task/description/${enc(undo.id)}`, {
              description: before.description,
            }),
          );
        }
        break;
      }
      case "cycle_tasks":
        if (undo.added.length > 0) {
          must(
            await call("DELETE", `/cycle/${enc(undo.id)}/tasks`, {
              taskIds: undo.added,
            }),
          );
        }
        for (const move of undo.moved) {
          must(
            await call("PUT", `/cycle/task/${enc(move.taskId)}`, {
              cycleId: move.fromCycleId,
            }),
          );
        }
        break;
      case "module_tasks":
        if (undo.added.length > 0) {
          must(
            await call("DELETE", `/module/${enc(undo.id)}/tasks`, {
              taskIds: undo.added,
            }),
          );
        }
        break;
    }
  } catch (error) {
    if (error instanceof ActionFailed) {
      const status = [400, 403, 404, 409].includes(error.status)
        ? (error.status as 400 | 403 | 404 | 409)
        : 502;
      throw new HTTPException(status, { message: error.message });
    }
    throw error;
  }
  spent.set(key, claims.exp);
}
