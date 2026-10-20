import type { PlanFacts } from "./facts";
import {
  ACTION_OPS,
  type ActionOp,
  actionParamsSchemas,
  type ChatBuildAction,
  type ChatBuildProblem,
  CREATING_OPS,
  DESTRUCTIVE_OPS,
  MAX_ACTIONS,
  type RefKind,
} from "./schema";

// Turns proposed actions (the model's, or the person's edited ones) into
// checked actions: names become ids ("Elena" → her member id, "WEB-12" →
// the task, "In Review" → its column slug), temp refs must point at an
// earlier action that creates the right kind of thing, and every action is
// checked against the caller's permissions and the facts of their AI scope.
// An action that can't be applied as written keeps a `problem` and is
// skipped on apply. Pure: everything it knows comes in as arguments.

export type Can = (permissions: Record<string, string[]>) => boolean;

export type ValidateContext = {
  facts: PlanFacts;
  can: Can;
  /** The project the chat is about; the default target of new things. */
  defaultProjectId?: string | null;
  /**
   * "model": invalid actions are dropped and ids are assigned (a1, a2, …).
   * "client": the person's actions keep their ids; invalid ones stay with a
   * problem.
   */
  source: "model" | "client";
};

/** Columns a new project starts with (project/controllers/create-project). */
export const NEW_PROJECT_STATUSES = [
  { slug: "to-do", name: "To Do" },
  { slug: "in-progress", name: "In Progress" },
  { slug: "in-review", name: "In Review" },
  { slug: "done", name: "Done" },
] as const;

type Params = Record<string, unknown>;

/** Where a thing lives: an existing project or one the plan creates. */
type ProjectSlot = { id: string } | { ref: string } | null;

type TempRef = {
  kind: RefKind;
  actionId: string;
  project: ProjectSlot;
  broken: boolean;
};

const PROJECT_TARGET_OPS: readonly ActionOp[] = [
  "create_task",
  "create_cycle",
  "create_module",
  "create_page",
];

const TASK_TARGET_OPS: readonly ActionOp[] = [
  "update_task",
  "set_status",
  "assign",
  "add_comment",
  "link_tasks",
  "run_agent",
  "delete_task",
];

/** The permissions an action needs (the API checks them again). */
export function requiredPermissions(
  op: ActionOp,
  params: Params,
): Record<string, string[]> {
  switch (op) {
    case "create_project":
      return { project: ["create"] };
    case "create_task": {
      const needs: Record<string, string[]> = { task: ["create"] };
      if (params.parentTaskId || params.parentRef)
        needs.task = ["create", "update"];
      if (Array.isArray(params.labels) && params.labels.length > 0) {
        needs.label = ["create"];
      }
      return needs;
    }
    case "update_task":
    case "set_status":
    case "add_comment":
    case "link_tasks":
      return { task: ["update"] };
    case "assign":
      return { task: ["assign"] };
    case "create_cycle":
      return { cycle: ["create"] };
    case "add_to_cycle":
      return { cycle: ["update"] };
    case "create_module":
      return { module: ["create"] };
    case "add_to_module":
      return { module: ["update"] };
    case "create_page":
      return { page: ["create"] };
    case "create_label":
      return { label: ["create"] };
    case "delete_task":
      return { task: ["delete"] };
    case "run_agent":
      return { ai: ["use"], task: ["read"] };
  }
}

function describePermissions(permissions: Record<string, string[]>): string {
  return Object.entries(permissions)
    .flatMap(([resource, actions]) =>
      actions.map((action) => `${resource}:${action}`),
    )
    .join(", ");
}

const normalizeName = (value: string) =>
  value.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();

type Resolved = { id: string } | { problem: ChatBuildProblem };

/** A member by id, full name, a whole word of the name, or a prefix. */
export function resolveMember(
  value: string,
  members: PlanFacts["members"],
): Resolved {
  if (members.some((member) => member.id === value)) return { id: value };
  const wanted = normalizeName(value);
  const notFound: Resolved = {
    problem: { code: "not_found", message: `No member called "${value}"` },
  };
  if (!wanted) return notFound;
  const tiers = [
    (name: string) => name === wanted,
    (name: string) => name.split(/\s+/).includes(wanted),
    (name: string) =>
      wanted.length >= 2 &&
      (name.startsWith(wanted) ||
        name.split(/\s+/).some((word) => word.startsWith(wanted))),
  ];
  for (const matches of tiers) {
    const found = members.filter((member) =>
      matches(normalizeName(member.name)),
    );
    if (found.length === 1 && found[0]) return { id: found[0].id };
    if (found.length > 1) {
      return {
        problem: {
          code: "ambiguous",
          message: `"${value}" matches ${found.length} members`,
          candidates: found
            .slice(0, 8)
            .map((member) => ({ id: member.id, name: member.name })),
        },
      };
    }
  }
  return notFound;
}

/** Something with an id and a name, by id or (case-insensitive) name. */
function resolveNamed<T extends { id: string; name: string }>(
  value: string,
  items: readonly T[],
  what: string,
): Resolved {
  if (items.some((item) => item.id === value)) return { id: value };
  const wanted = normalizeName(value);
  const found = items.filter((item) => normalizeName(item.name) === wanted);
  if (found.length === 1 && found[0]) return { id: found[0].id };
  if (found.length > 1) {
    return {
      problem: {
        code: "ambiguous",
        message: `"${value}" matches ${found.length} ${what}s`,
        candidates: found
          .slice(0, 8)
          .map((item) => ({ id: item.id, name: item.name })),
      },
    };
  }
  return {
    problem: { code: "not_found", message: `No ${what} "${value}"` },
  };
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asObject(value: unknown): Params | null {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Params)
    : null;
}

/** Drops nulls and empty strings the model uses for "not given". */
function compact(params: Params, keepNull: readonly string[] = []): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      if (keepNull.includes(key)) out[key] = null;
      continue;
    }
    if (value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Checks and resolves a plan. The result holds at most MAX_ACTIONS actions,
 * each valid against its params schema; problems are reported per action.
 */
export function validateActions(
  raw: readonly unknown[],
  ctx: ValidateContext,
): { actions: ChatBuildAction[]; truncated: boolean } {
  const { facts, can } = ctx;
  const projectsById = new Map(facts.projects.map((p) => [p.id, p]));
  const tasksById = new Map(facts.tasks.map((t) => [t.id, t]));
  const tasksByKey = new Map(facts.tasks.map((t) => [t.key.toLowerCase(), t]));
  const temps = new Map<string, TempRef>();
  const usedIds = new Set<string>();
  const actions: ChatBuildAction[] = [];
  const truncated = raw.length > MAX_ACTIONS;

  for (const item of raw.slice(0, MAX_ACTIONS)) {
    const source = asObject(item);
    if (!source) continue;
    const op = source.op as ActionOp;
    if (!ACTION_OPS.includes(op)) continue;

    let actionId = text(source.id, 40);
    if (ctx.source === "model" || !actionId || usedIds.has(actionId)) {
      let n = actions.length + 1;
      actionId = `a${n}`;
      while (usedIds.has(actionId)) actionId = `a${++n}`;
    }
    usedIds.add(actionId);

    const problems: ChatBuildProblem[] = [];
    const flag = (problem: ChatBuildProblem) => problems.push(problem);
    const params = compact(asObject(source.params) ?? {});
    if (op === "update_task") {
      params.fields = compact(asObject(params.fields) ?? {}, ["dueDate"]);
    }

    // --- Temp refs and the thing each one names ---
    const tempOf = (ref: unknown, kind: RefKind): TempRef | null => {
      if (typeof ref !== "string") return null;
      const temp = temps.get(ref);
      if (!temp || temp.kind !== kind) {
        flag({
          code: "unresolved_ref",
          message: `"${ref}" is not a ${kind} created earlier in this plan`,
        });
        return null;
      }
      if (temp.broken) {
        flag({
          code: "unresolved_ref",
          message: `Depends on action ${temp.actionId}, which can't be applied`,
        });
      }
      return temp;
    };
    // A model sometimes puts a temp ref where an id goes, or an existing
    // item's id, key or name (projectRef "WEB") where a temp ref goes.
    const moveRef = (idKey: string, refKey: string, kind: RefKind) => {
      const value = params[idKey];
      if (typeof value === "string" && temps.get(value)?.kind === kind) {
        params[refKey] ??= value;
        delete params[idKey];
      }
      const ref = params[refKey];
      if (
        typeof ref === "string" &&
        temps.get(ref)?.kind !== kind &&
        params[idKey] === undefined
      ) {
        params[idKey] = ref;
        delete params[refKey];
      }
    };

    // --- The project (create_task, create_cycle, create_module, create_page) ---
    let project: ProjectSlot = null;
    if (PROJECT_TARGET_OPS.includes(op)) {
      moveRef("projectId", "projectRef", "project");
      if (params.projectRef !== undefined) {
        delete params.projectId;
        const temp = tempOf(params.projectRef, "project");
        project = temp ? { ref: String(params.projectRef) } : null;
      } else {
        if (params.projectId === undefined) {
          const onlyNew = [...temps.entries()].filter(
            ([, temp]) => temp.kind === "project",
          );
          if (ctx.defaultProjectId && projectsById.has(ctx.defaultProjectId)) {
            params.projectId = ctx.defaultProjectId;
          } else if (onlyNew.length === 1 && onlyNew[0]) {
            params.projectRef = onlyNew[0][0];
            project = { ref: onlyNew[0][0] };
          } else {
            flag({ code: "invalid", message: "Which project?" });
          }
        }
        if (typeof params.projectId === "string") {
          const wanted = normalizeName(params.projectId);
          const match =
            projectsById.get(params.projectId) ??
            facts.projects.find(
              (p) =>
                p.key.toLowerCase() === wanted ||
                normalizeName(p.name) === wanted,
            );
          if (match) {
            params.projectId = match.id;
            project = { id: match.id };
            if (match.archived) {
              flag({ code: "invalid", message: `${match.name} is archived` });
            }
            const feature =
              op === "create_cycle"
                ? match.cyclesEnabled
                : op === "create_module"
                  ? match.modulesEnabled
                  : op === "create_page"
                    ? match.pagesEnabled
                    : true;
            if (!feature) {
              flag({
                code: "feature_off",
                message: `${match.name} has this feature turned off`,
              });
            }
          } else {
            flag({ code: "not_found", message: "Project not found" });
          }
        }
      }
    }

    // --- Tasks: ids or keys, and temp refs ---
    const projectOfTaskRef = (ref: string): ProjectSlot =>
      temps.get(ref)?.project ?? null;
    const resolveTask = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const task =
        tasksById.get(value) ?? tasksByKey.get(value.trim().toLowerCase());
      if (!task) {
        flag({ code: "not_found", message: `Task ${value} not found` });
        return null;
      }
      return task.id;
    };
    let taskProject: ProjectSlot = null;
    if (TASK_TARGET_OPS.includes(op)) {
      moveRef("taskId", "taskRef", "task");
      if (op !== "delete_task" && params.taskRef !== undefined) {
        delete params.taskId;
        if (tempOf(params.taskRef, "task")) {
          taskProject = projectOfTaskRef(String(params.taskRef));
        }
      } else if (params.taskId !== undefined) {
        const taskId = resolveTask(params.taskId);
        if (taskId) {
          params.taskId = taskId;
          taskProject = { id: tasksById.get(taskId)?.projectId ?? "" };
        }
      } else {
        flag({ code: "invalid", message: "Which task?" });
      }
    }
    if (op === "link_tasks") {
      moveRef("targetTaskId", "targetRef", "task");
      if (params.targetRef !== undefined) {
        delete params.targetTaskId;
        tempOf(params.targetRef, "task");
      } else if (params.targetTaskId !== undefined) {
        const id = resolveTask(params.targetTaskId);
        if (id) params.targetTaskId = id;
      } else {
        flag({ code: "invalid", message: "Which task to link to?" });
      }
    }
    if (op === "create_task") {
      moveRef("parentTaskId", "parentRef", "task");
      if (params.parentRef !== undefined) {
        delete params.parentTaskId;
        tempOf(params.parentRef, "task");
      } else if (params.parentTaskId !== undefined) {
        const id = resolveTask(params.parentTaskId);
        if (id) params.parentTaskId = id;
      }
    }

    // --- Cycles and modules: ids or names, plus task lists ---
    const memberships = (
      idKey: "cycleId" | "moduleId",
      refKey: "cycleRef" | "moduleRef",
      kind: "cycle" | "module",
      items: readonly { id: string; name: string; projectId: string }[],
    ) => {
      moveRef(idKey, refKey, kind);
      let home: ProjectSlot = null;
      if (params[refKey] !== undefined) {
        delete params[idKey];
        home = tempOf(params[refKey], kind)?.project ?? null;
      } else if (typeof params[idKey] === "string") {
        const value = String(params[idKey]);
        const resolved = resolveNamed(value, items, kind);
        if ("id" in resolved) {
          params[idKey] = resolved.id;
          home = {
            id: items.find((item) => item.id === resolved.id)?.projectId ?? "",
          };
        } else {
          flag({ ...resolved.problem, field: idKey, value });
        }
      } else {
        flag({ code: "invalid", message: `Which ${kind}?` });
      }
      const taskIds: string[] = [];
      const taskRefs: string[] = [];
      for (const value of [
        ...stringList(params.taskIds),
        ...stringList(params.taskRefs),
      ]) {
        if (temps.get(value)?.kind === "task") {
          if (tempOf(value, "task")) taskRefs.push(value);
          const slot = projectOfTaskRef(value);
          if (home && slot && !sameSlot(home, slot)) {
            flag({
              code: "invalid",
              message: `Tasks must be in the ${kind}'s project`,
            });
          }
          continue;
        }
        const id = resolveTask(value);
        if (!id) continue;
        taskIds.push(id);
        const slot = { id: tasksById.get(id)?.projectId ?? "" };
        if (home && !sameSlot(home, slot)) {
          flag({
            code: "invalid",
            message: `Tasks must be in the ${kind}'s project`,
          });
        }
      }
      if (taskIds.length > 0) params.taskIds = [...new Set(taskIds)];
      else delete params.taskIds;
      if (taskRefs.length > 0) params.taskRefs = [...new Set(taskRefs)];
      else delete params.taskRefs;
      if (taskIds.length + taskRefs.length === 0 && problems.length === 0) {
        flag({ code: "invalid", message: "No tasks to add" });
      }
    };
    if (op === "add_to_cycle") {
      memberships("cycleId", "cycleRef", "cycle", facts.cycles);
    }
    if (op === "add_to_module") {
      memberships("moduleId", "moduleRef", "module", facts.modules);
    }

    // --- People and agents ---
    const resolvePeople = (key: string) => {
      const values = stringList(params[key]);
      if (values.length === 0) return;
      const ids: string[] = [];
      for (const value of values) {
        const resolved = resolveMember(value, facts.members);
        if ("id" in resolved) ids.push(resolved.id);
        else {
          flag({ ...resolved.problem, field: key, value });
          ids.push(value);
        }
      }
      params[key] = [...new Set(ids)];
    };
    if (op === "create_task") resolvePeople("assigneeIds");
    if (op === "assign") resolvePeople("userIds");
    if (op === "create_project" && typeof params.leadUserId === "string") {
      const lead = params.leadUserId;
      const resolved = resolveMember(lead, facts.members);
      if ("id" in resolved) params.leadUserId = resolved.id;
      else flag({ ...resolved.problem, field: "leadUserId", value: lead });
    }
    if (op === "run_agent" && typeof params.agentId === "string") {
      const agent = params.agentId;
      const resolved = resolveNamed(agent, facts.agents, "agent");
      if ("id" in resolved) {
        params.agentId = resolved.id;
        if (!facts.agents.find((agent) => agent.id === resolved.id)?.enabled) {
          flag({ code: "invalid", message: "This agent is turned off" });
        }
      } else {
        flag({ ...resolved.problem, field: "agentId", value: agent });
      }
    }

    // --- Statuses: a column slug or name of the right project ---
    if (
      (op === "create_task" || op === "set_status") &&
      typeof params.status === "string"
    ) {
      const slot = op === "create_task" ? project : taskProject;
      const columns =
        slot && "ref" in slot
          ? NEW_PROJECT_STATUSES
          : slot
            ? (projectsById.get(slot.id)?.columns ?? [])
            : null;
      if (columns) {
        const wanted = normalizeName(params.status);
        const match = columns.find(
          (column) =>
            column.slug === params.status ||
            normalizeName(column.name) === wanted ||
            column.slug === wanted.replace(/\s+/g, "-"),
        );
        if (match) params.status = match.slug;
        else {
          flag({
            code: "invalid",
            message: `Unknown status "${params.status}"`,
          });
        }
      }
    }

    // --- Dates and labels ---
    if (op === "create_cycle") {
      const start = params.startDate;
      const end = params.endDate;
      if ((start === undefined) !== (end === undefined)) {
        flag({
          code: "invalid",
          message: "Give a cycle both a start and an end date, or neither",
        });
      } else if (
        typeof start === "string" &&
        typeof end === "string" &&
        end < start
      ) {
        flag({ code: "invalid", message: "The cycle ends before it starts" });
      }
    }
    if (op === "create_label" && typeof params.color !== "string") {
      params.color = "gray";
    }
    if (op === "create_project" && typeof params.key === "string") {
      params.key = params.key.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
    }

    // --- The params schema ---
    const parsed = actionParamsSchemas[op].safeParse(params);
    if (!parsed.success) {
      if (ctx.source === "model") continue;
      flag({
        code: "invalid",
        message: parsed.error.issues[0]?.message ?? "Invalid action",
      });
    }
    const finalParams = (parsed.success ? parsed.data : params) as Params;

    // --- Permissions ---
    const needs = requiredPermissions(op, finalParams);
    if (!can(needs)) {
      flag({
        code: "forbidden",
        message: `You need ${describePermissions(needs)} for this`,
      });
    }

    // Only the first problem is shown; it is the one to fix first.
    const problem = problems[0] ?? null;

    // --- Register what this action creates ---
    let tempId =
      text(source.tempId, 40) || text(asObject(source.refs)?.tempId, 40);
    const kind = CREATING_OPS[op as keyof typeof CREATING_OPS] as
      | RefKind
      | undefined;
    if (tempId && (!kind || temps.has(tempId))) tempId = "";
    if (tempId && kind) {
      temps.set(tempId, {
        kind,
        actionId,
        project: kind === "project" ? { ref: tempId } : project,
        broken: problem !== null,
      });
    }

    const title =
      text(source.title, 300) || fallbackTitle(op, finalParams) || op;
    const detail = text(source.detail, 2000);
    actions.push({
      id: actionId,
      op,
      title,
      ...(detail ? { detail } : {}),
      params: finalParams,
      risk: DESTRUCTIVE_OPS.includes(op) ? "destructive" : "write",
      ...(tempId ? { refs: { tempId } } : {}),
      problem,
    } as ChatBuildAction);
  }
  return { actions, truncated };
}

function sameSlot(a: NonNullable<ProjectSlot>, b: NonNullable<ProjectSlot>) {
  return "id" in a ? "id" in b && a.id === b.id : "ref" in b && a.ref === b.ref;
}

function fallbackTitle(op: ActionOp, params: Params): string {
  const name =
    typeof params.name === "string"
      ? params.name
      : typeof params.title === "string"
        ? params.title
        : "";
  return name ? `${op.replace(/_/g, " ")}: ${name}` : "";
}

/** Every task id or key the raw actions mention (to load them first). */
export function mentionedTaskRefs(raw: readonly unknown[]): string[] {
  const refs = new Set<string>();
  for (const item of raw) {
    const params = asObject(asObject(item)?.params);
    if (!params) continue;
    for (const key of ["taskId", "targetTaskId", "parentTaskId"]) {
      if (typeof params[key] === "string") refs.add(params[key] as string);
    }
    for (const value of stringList(params.taskIds)) refs.add(value);
    for (const value of stringList(params.taskRefs)) refs.add(value);
  }
  return [...refs].slice(0, 200);
}
