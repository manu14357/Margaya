import { and, asc, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type AiContextItem,
  assertProjectInScope,
  projectDataTier,
  renderContext,
  resolveAiScopeFor,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt } from "../ai/prompt";
import db from "../database";
import {
  columnTable,
  cycleTable,
  labelTable,
  moduleTable,
  projectTable,
  userTable,
} from "../database/schema";
import { isValidDateString } from "../utils/calendar-date";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import {
  BUILD_LABEL_COLORS,
  BUILD_LIMITS,
  BUILD_PRIORITIES,
  type BuildProposal,
} from "./schema";

// "Talk to build": a prompt becomes a structured PROPOSAL (project, columns,
// labels, cycles, modules, tasks with sub-tasks). Nothing is created here;
// the person reviews and edits the proposal, then /ai-build/apply creates
// it through the ordinary routes.

const BUILD_INSTRUCTIONS = `Your job: turn the user's request into a project plan proposal for Margaya, as JSON matching the given schema. A person reviews and edits it before anything is created.

Rules:
- project: when the request builds into an existing project (described in the context), set project to null. Otherwise propose a short name, a 2-5 letter key (letters and digits only) and a one-paragraph description.
- columns: only workflow columns the project needs beyond the ones it already has. A new project starts with To Do, In Progress, In Review and Done. Usually leave this empty.
- labels: a few useful labels (at most 8), each with a color from the schema. Tasks list label names.
- cycles: time-boxed sprints when the request asks for sprints, iterations or dates. Give each a short ref (c1, c2, ...), a name, and YYYY-MM-DD start and end dates that follow one another without overlapping, starting no earlier than today. Use null dates only when no timing is known.
- modules: larger workstreams or features that group tasks. Give each a short ref (m1, m2, ...).
- tasks: concrete, actionable tasks in a sensible order, each with a short title, a description of one to three sentences (what and why, plus acceptance criteria when useful), a priority, an estimate in story points (1, 2, 3, 5, 8 or 13; null if unclear), the cycleRef and moduleRef it belongs to (or null), and up to 6 sub-tasks for steps worth tracking. Keep to at most 40 tasks.
- column on a task: null unless the work clearly belongs in a specific column.
- summary: one or two sentences describing the plan.
- Write names, titles and descriptions in the answer language. Do not invent people, assignees or links.`;

const nullableString = { type: ["string", "null"] };
const refString = {
  type: ["string", "null"],
  description: "A ref from cycles/modules, or null.",
};

/** The JSON Schema the model answers with (structured output). */
export const BUILD_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "project",
    "columns",
    "labels",
    "cycles",
    "modules",
    "tasks",
  ],
  properties: {
    summary: { type: "string" },
    project: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "key", "description"],
      properties: {
        name: { type: "string" },
        key: { type: "string" },
        description: { type: "string" },
      },
    },
    columns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color"],
        properties: {
          name: { type: "string" },
          color: { type: "string", enum: [...BUILD_LABEL_COLORS] },
        },
      },
    },
    cycles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "name", "description", "startDate", "endDate"],
        properties: {
          ref: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          startDate: { ...nullableString, description: "YYYY-MM-DD" },
          endDate: { ...nullableString, description: "YYYY-MM-DD" },
        },
      },
    },
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "name", "description"],
        properties: {
          ref: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "description",
          "priority",
          "estimate",
          "column",
          "labels",
          "cycleRef",
          "moduleRef",
          "subtasks",
        ],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: [...BUILD_PRIORITIES] },
          estimate: { type: ["number", "null"] },
          column: nullableString,
          labels: { type: "array", items: { type: "string" } },
          cycleRef: refString,
          moduleRef: refString,
          subtasks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: { title: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

// --- Normalization: the model's JSON is untrusted; keep what fits. ---

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function day(value: unknown): string | null {
  return typeof value === "string" && isValidDateString(value) ? value : null;
}

/** A project key from a name: initials or the first letters, upper case. */
export function projectKeyFrom(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const initials = words.map((word) => [...word][0]).join("");
  const key = initials.length >= 2 ? initials : [...(words[0] ?? "")].join("");
  return [...key].slice(0, 5).join("") || "NEW";
}

function cleanKey(value: string, name: string): string {
  const key = [...value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "")]
    .slice(0, 8)
    .join("");
  return key.length >= 2 ? key : projectKeyFrom(name);
}

function uniqueRef(wanted: string, prefix: string, used: Set<string>): string {
  let n = used.size;
  let ref = wanted || `${prefix}${n + 1}`;
  while (used.has(ref)) ref = `${prefix}${++n}`;
  used.add(ref);
  return ref;
}

/**
 * The model's answer as a valid proposal: unknown fields dropped, text
 * clipped, enums and dates checked, references to missing cycles or
 * modules cleared, and everything capped to BUILD_LIMITS.
 */
export function normalizeProposal(
  raw: unknown,
  options: { newProject: boolean; fallbackName: string },
): BuildProposal {
  const root = asObject(raw) ?? {};

  let project: BuildProposal["project"] = null;
  if (options.newProject) {
    const source = asObject(root.project) ?? {};
    const name =
      text(source.name, 120) ||
      options.fallbackName.slice(0, 120) ||
      "New project";
    project = {
      name,
      key: cleanKey(text(source.key, 40), name),
      description: text(source.description, 5000),
    };
  }

  const columnNames = new Set<string>();
  const columns: BuildProposal["columns"] = [];
  for (const item of asArray(root.columns)) {
    const name = text(asObject(item)?.name, 60);
    if (!name || columnNames.has(name.toLowerCase())) continue;
    columnNames.add(name.toLowerCase());
    columns.push({ name });
    if (columns.length >= BUILD_LIMITS.columns) break;
  }

  const labels: BuildProposal["labels"] = [];
  const labelNames = new Set<string>();
  const addLabel = (name: string, color: unknown) => {
    if (!name || labelNames.has(name.toLowerCase())) return;
    if (labels.length >= BUILD_LIMITS.labels) return;
    labelNames.add(name.toLowerCase());
    labels.push({ name, color: oneOf(color, BUILD_LABEL_COLORS, "gray") });
  };
  for (const item of asArray(root.labels)) {
    const source = asObject(item);
    addLabel(text(source?.name, 40), source?.color);
  }

  const cycleRefs = new Set<string>();
  const cycles: BuildProposal["cycles"] = [];
  for (const item of asArray(root.cycles)) {
    const source = asObject(item);
    const name = text(source?.name, 255);
    if (!name || cycles.length >= BUILD_LIMITS.cycles) continue;
    let startDate = day(source?.startDate);
    let endDate = day(source?.endDate);
    // Both dates or neither (a draft), and never ending before starting.
    if (!startDate || !endDate || endDate < startDate) {
      startDate = null;
      endDate = null;
    }
    cycles.push({
      ref: uniqueRef(text(source?.ref, 40), "c", cycleRefs),
      name,
      description: text(source?.description, 10_000),
      startDate,
      endDate,
    });
  }

  const moduleRefs = new Set<string>();
  const modules: BuildProposal["modules"] = [];
  for (const item of asArray(root.modules)) {
    const source = asObject(item);
    const name = text(source?.name, 255);
    if (!name || modules.length >= BUILD_LIMITS.modules) continue;
    modules.push({
      ref: uniqueRef(text(source?.ref, 40), "m", moduleRefs),
      name,
      description: text(source?.description, 5000),
    });
  }

  const tasks: BuildProposal["tasks"] = [];
  let subtaskCount = 0;
  for (const item of asArray(root.tasks)) {
    const source = asObject(item);
    const title = text(source?.title, 255);
    if (!title || tasks.length >= BUILD_LIMITS.tasks) continue;
    const estimate =
      typeof source?.estimate === "number" &&
      Number.isFinite(source.estimate) &&
      source.estimate >= 0 &&
      source.estimate <= 1000
        ? source.estimate
        : null;
    const taskLabels: string[] = [];
    for (const label of asArray(source?.labels)) {
      const name = text(label, 40);
      if (
        !name ||
        taskLabels.some((l) => l.toLowerCase() === name.toLowerCase())
      )
        continue;
      if (taskLabels.length >= BUILD_LIMITS.labelsPerTask) break;
      // A label a task uses but the list forgot joins the list.
      addLabel(name, "gray");
      if (labelNames.has(name.toLowerCase())) taskLabels.push(name);
    }
    const cycleRef = text(source?.cycleRef, 40);
    const moduleRef = text(source?.moduleRef, 40);
    tasks.push({
      title,
      description: text(source?.description, 10_000),
      priority: oneOf(source?.priority, BUILD_PRIORITIES, "no-priority"),
      estimate,
      column: text(source?.column, 60) || null,
      labels: taskLabels,
      cycleRef: cycleRefs.has(cycleRef) ? cycleRef : null,
      moduleRef: moduleRefs.has(moduleRef) ? moduleRef : null,
      subtasks: asArray(source?.subtasks)
        .map((subtask) => ({ title: text(asObject(subtask)?.title, 255) }))
        .filter((subtask) => subtask.title)
        .slice(
          0,
          Math.min(
            BUILD_LIMITS.subtasksPerTask,
            BUILD_LIMITS.subtasks - subtaskCount,
          ),
        ),
    });
    subtaskCount += tasks.at(-1)?.subtasks.length ?? 0;
  }

  return {
    summary: text(root.summary, 2000),
    project,
    columns,
    labels,
    cycles,
    modules,
    tasks,
  };
}

// --- Context: what the model may know about the target project. ---

async function projectFacts(projectId: string, workspaceId: string) {
  const [[project], columns, labels, cycles, modules] = await Promise.all([
    db
      .select({
        name: projectTable.name,
        slug: projectTable.slug,
        description: projectTable.description,
        cyclesEnabled: projectTable.cyclesEnabled,
        modulesEnabled: projectTable.modulesEnabled,
      })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1),
    db
      .select({ name: columnTable.name })
      .from(columnTable)
      .where(eq(columnTable.projectId, projectId))
      .orderBy(asc(columnTable.position)),
    db
      .selectDistinct({ name: labelTable.name })
      .from(labelTable)
      .where(
        and(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.taskId)),
      )
      .limit(40),
    db
      .select({
        name: cycleTable.name,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
      })
      .from(cycleTable)
      .where(
        and(eq(cycleTable.projectId, projectId), isNull(cycleTable.archivedAt)),
      )
      .limit(30),
    db
      .select({ name: moduleTable.name })
      .from(moduleTable)
      .where(
        and(
          eq(moduleTable.projectId, projectId),
          isNull(moduleTable.archivedAt),
        ),
      )
      .limit(30),
  ]);
  return { project, columns, labels, cycles, modules };
}

function listLine(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}: ${values.join(", ")}` : null;
}

async function loadBuildProjectContext(
  scope: Awaited<ReturnType<typeof resolveAiScopeFor>>,
  projectId: string,
): Promise<{ item: AiContextItem; name: string }> {
  const facts = await projectFacts(projectId, scope.workspaceId);
  if (!facts.project) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  const { project } = facts;
  const textBody = [
    `Project: ${project.name} (key ${project.slug.toUpperCase()})`,
    project.description ? `Description: ${project.description}` : null,
    listLine(
      "Existing columns",
      facts.columns.map((column) => column.name),
    ),
    listLine(
      "Existing labels",
      facts.labels.map((label) => label.name),
    ),
    project.cyclesEnabled
      ? listLine(
          "Existing cycles (avoid overlapping their dates)",
          facts.cycles.map((cycle) =>
            cycle.startDate && cycle.endDate
              ? `${cycle.name} ${cycle.startDate}..${cycle.endDate}`
              : cycle.name,
          ),
        )
      : "Cycles are turned off for this project: propose no cycles.",
    project.modulesEnabled
      ? listLine(
          "Existing modules",
          facts.modules.map((module) => module.name),
        )
      : "Modules are turned off for this project: propose no modules.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    name: project.name,
    item: {
      kind: "project",
      id: projectId,
      projectId,
      title: project.name,
      url: `/dashboard/workspace/${scope.workspaceId}/project/${projectId}/board`,
      source: `project:${project.slug.toUpperCase()}`,
      author: null,
      text: textBody,
      dataTier: projectDataTier(scope, projectId),
    },
  };
}

async function userLocale(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user?.locale ?? null;
}

/**
 * Checks that the caller may build there (403 / 404 before any model
 * call): a new project needs project:create; an existing one must be a
 * project AI may read for them, and needs task:create.
 */
export async function assertBuildTarget(
  c: Context,
  projectId: string | undefined,
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const can = await workspacePermissionChecker(c);
  const scope = await resolveAiScopeFor({ workspaceId, userId, can });
  if (projectId) {
    assertProjectInScope(scope, projectId);
    if (!can({ task: ["create"] })) {
      throw new HTTPException(403, {
        message: "Building into a project needs the task:create permission",
      });
    }
  } else if (!can({ project: ["create"] })) {
    throw new HTTPException(403, {
      message: "Building a new project needs the project:create permission",
    });
  }
  return scope;
}

export async function proposeBuild(
  c: Context,
  input: { projectId?: string; prompt: string; depth?: "balanced" | "deep" },
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const scope = await assertBuildTarget(c, input.projectId);

  const target = input.projectId
    ? await loadBuildProjectContext(scope, input.projectId)
    : null;
  const context = target ? [target.item] : [];
  const where = target
    ? "Build into the existing project described above (set project to null)."
    : "Propose a new project.";

  const { value, result } = await aiCompleteJson<unknown>({
    workspaceId,
    userId,
    feature: "talk_to_build",
    tier: input.depth ?? "balanced",
    context,
    system: buildSystemPrompt({
      instructions: BUILD_INSTRUCTIONS,
      locale: await userLocale(userId),
    }),
    messages: [
      {
        role: "user",
        content: [
          context.length > 0 ? renderContext(context) : null,
          where,
          `Request:\n${input.prompt}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    jsonSchema: BUILD_JSON_SCHEMA,
    maxTokens: 12_000,
  });

  return {
    proposal: normalizeProposal(value, {
      newProject: !target,
      fallbackName: input.prompt.split(/\r?\n/)[0] ?? "",
    }),
    target: target
      ? { projectId: input.projectId as string, projectName: target.name }
      : null,
    model: result.meta.model,
  };
}
