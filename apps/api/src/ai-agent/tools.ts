import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  type AiContextItem,
  type AiScope,
  filterToScope,
  loadPageContext,
  loadProjectsContext,
  loadTaskContext,
  renderContext,
} from "../ai/context";
import { wrapUntrusted } from "../ai/prompt";
import { createRedactor } from "../ai/redact";
import type { ChatTool } from "../ai/types";
import db from "../database";
import { columnTable, projectTable, taskTable } from "../database/schema";
import { searchWorkspace } from "../search/search-workspace";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { RELATION_INPUT_NAMES } from "../task-relation/types";
import type { Change, TaskFields } from "./changes";
import {
  type PermissionMap,
  principalProjectAllows,
  satisfies,
} from "./rights";

// The agent's tools (report 02, §4.8). Reads go through the AI context
// loaders under the run's scope (the invoker's visibility ∩ the agent's,
// AI-on projects only); writes become typed change-set operations that the
// runtime applies through the API with the run's key, or holds for
// approval. Only agents an admin gave web access reach outside Margaya
// (web search and MCP connectors, built per run by the runtime); every
// other agent has no network tool, which removes the "external
// communication" leg of the lethal trifecta. Tools that touch roles,
// invitations, keys, webhooks, sharing or publication do not exist here.

export type ToolRisk = "read" | "write" | "destructive";

export type ToolContext = {
  workspaceId: string;
  principalUserId: string;
  scope: AiScope;
  /** The run's capped rights (agent role ∩ invoker). */
  statements: PermissionMap;
  /** Context the run has read so far (data tier for later calls). */
  seen: AiContextItem[];
  /** The run's project, and its task when it has one. */
  projectId: string;
  taskId: string | null;
};

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * The change asks for what is already there: nothing to do, which is not a
 * failure. The runtime records an ok step and creates no change.
 */
export class NothingToChange extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NothingToChange";
  }
}

type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  risk: ToolRisk;
  requires: PermissionMap;
  schema: S;
  /** The model's input schema when it isn't derived from `schema`. */
  jsonSchema?: Record<string, unknown>;
  /** Writes that always wait for approval (calls to outside services). */
  alwaysApprove?: boolean;
  read?: (ctx: ToolContext, args: z.output<S>) => Promise<string>;
  plan?: (ctx: ToolContext, args: z.output<S>) => Promise<Change>;
};

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

const taskRef = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("A task id, or its key such as WEB-12");

// --- Lookups (always inside the run's scope) ---

type ToolTask = {
  id: string;
  projectId: string;
  number: number | null;
  title: string;
  status: string;
  priority: string | null;
  dueDate: Date | null;
  description: string | null;
  slug: string;
};

const KEY = /^([\p{L}\p{N}_-]+)-(\d+)$/u;

/** A live task in scope by id or key; anything else reads as not found. */
/** A project in the run's scope by id or by its key ("WEB"), as task keys show it. */
async function findProjectId(ctx: ToolContext, ref: string): Promise<string> {
  if (ctx.scope.projectIds.has(ref)) return ref;
  const projectIds = [...ctx.scope.projectIds];
  const [row] = projectIds.length
    ? await db
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            inArray(projectTable.id, projectIds),
            eq(projectTable.workspaceId, ctx.workspaceId),
            sql`lower(${projectTable.slug}) = lower(${ref.trim()})`,
          ),
        )
        .limit(1)
    : [];
  if (!row) throw new ToolError("Project not found");
  return row.id;
}

export async function findTask(
  ctx: ToolContext,
  ref: string,
): Promise<ToolTask> {
  const projectIds = [...ctx.scope.projectIds];
  if (projectIds.length === 0) throw new ToolError("Task not found");
  const key = KEY.exec(ref.normalize("NFKC"));
  const columns = {
    id: taskTable.id,
    projectId: taskTable.projectId,
    number: taskTable.number,
    title: taskTable.title,
    status: taskTable.status,
    priority: taskTable.priority,
    dueDate: taskTable.dueDate,
    description: taskTable.description,
    slug: projectTable.slug,
  };
  const base = and(
    inArray(taskTable.projectId, projectIds),
    isNull(taskTable.deletedAt),
    eq(projectTable.workspaceId, ctx.workspaceId),
  );
  const [byId] = await db
    .select(columns)
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(and(base, eq(taskTable.id, ref)))
    .limit(1);
  if (byId) return byId;
  if (key?.[1] && key[2]) {
    const [byKey] = await db
      .select(columns)
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          base,
          sql`lower(${projectTable.slug}) = lower(${key[1]})`,
          eq(taskTable.number, Number(key[2])),
        ),
      )
      .limit(1);
    if (byKey) return byKey;
  }
  throw new ToolError("Task not found");
}

export function taskLabel(task: Pick<ToolTask, "slug" | "number" | "title">) {
  return `${task.slug.toUpperCase()}-${task.number ?? 0} ${task.title}`.slice(
    0,
    200,
  );
}

async function projectColumns(projectId: string) {
  return db
    .select({ slug: columnTable.slug, name: columnTable.name })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

async function assertColumn(projectId: string, status: string) {
  const columns = await projectColumns(projectId);
  const match = columns.find(
    (column) =>
      column.slug === status ||
      column.name.toLowerCase() === status.toLowerCase(),
  );
  if (!match) {
    throw new ToolError(
      `Unknown status "${status}". Use one of: ${columns.map((c) => c.slug).join(", ")}`,
    );
  }
  return match.slug;
}

/** The invoker's restricted-project role must allow it too. */
async function assertPrincipalMay(
  ctx: ToolContext,
  projectId: string,
  required: PermissionMap,
) {
  if (
    !satisfies(ctx.statements, required) ||
    !(await principalProjectAllows(
      ctx.workspaceId,
      ctx.principalUserId,
      projectId,
      required,
    ))
  ) {
    throw new ToolError("You are not allowed to do that here");
  }
}

function notFound(error: unknown): never {
  if (error instanceof ToolError) throw error;
  if (error instanceof HTTPException) {
    throw new ToolError(
      error.status === 403
        ? "Not allowed"
        : "Not found, or not available to AI",
    );
  }
  throw error;
}

// --- The catalog ---

export const AGENT_TOOLS: ToolDef[] = [
  tool({
    name: "read_task",
    description:
      "Read a task: title, status, priority, due date, description and its latest comments. Content comes back inside <untrusted> blocks.",
    risk: "read",
    requires: { task: ["read"] },
    schema: z.object({ task: taskRef }).strict(),
    async read(ctx, args) {
      const task = await findTask(ctx, args.task);
      const items = await loadTaskContext(ctx.scope, task.id, {
        comments: 10,
      }).catch(notFound);
      ctx.seen.push(...items);
      const columns = await projectColumns(task.projectId);
      return [
        `Task id: ${task.id} (key ${task.slug.toUpperCase()}-${task.number ?? 0}, project id ${task.projectId})`,
        `Statuses in this project: ${columns.map((c) => c.slug).join(", ")}`,
        renderContext(items, { maxChars: 20_000 }),
      ].join("\n");
    },
  }),
  tool({
    name: "read_project",
    description:
      "Read a project's name, description and its statuses (columns). Takes the project id or its key (WEB for WEB-12).",
    risk: "read",
    requires: { project: ["read"] },
    schema: z.object({ projectId: z.string().trim().min(1).max(100) }).strict(),
    async read(ctx, args) {
      const projectId = await findProjectId(ctx, args.projectId);
      const items = await loadProjectsContext(ctx.scope, [projectId]);
      ctx.seen.push(...items);
      const columns = await projectColumns(projectId);
      return [
        renderContext(items, { maxChars: 8_000 }),
        `Statuses: ${columns.map((c) => `${c.slug} (${c.name})`).join(", ")}`,
      ].join("\n");
    },
  }),
  tool({
    name: "read_page",
    description: "Read a page (document) by id.",
    risk: "read",
    requires: { page: ["read"] },
    schema: z.object({ pageId: z.string().trim().min(1).max(100) }).strict(),
    async read(ctx, args) {
      const item = await loadPageContext(ctx.scope, args.pageId, {
        maxChars: 16_000,
      }).catch(notFound);
      ctx.seen.push(item);
      return renderContext([item], { maxChars: 18_000 });
    },
  }),
  tool({
    name: "search_workspace",
    description:
      'Full-text search over tasks, pages and comments you may read. Supports "exact phrases", or and -exclude. Returns up to 10 hits with ids.',
    risk: "read",
    requires: { task: ["read"] },
    schema: z
      .object({
        query: z.string().trim().min(1).max(200),
        types: z
          .array(z.enum(["task", "page", "comment"]))
          .max(3)
          .optional(),
      })
      .strict(),
    async read(ctx, args) {
      const hits = await searchWorkspace({
        userId: ctx.principalUserId,
        workspaceId: ctx.workspaceId,
        query: args.query,
        types: args.types,
        limit: 10,
        can: (permissions) => satisfies(ctx.statements, permissions),
      });
      const inScope = filterToScope(ctx.scope, hits);
      if (inScope.length === 0) return "No results.";
      return inScope
        .map((hit) => {
          const key =
            hit.taskNumber !== undefined && hit.taskNumber !== null
              ? `${(hit.projectSlug ?? "").toUpperCase()}-${hit.taskNumber} `
              : "";
          return wrapUntrusted({
            source: `${hit.type}:${hit.id}`,
            text: `${key}${hit.title}${hit.snippet ? `\n${hit.snippet.text}` : ""}${hit.taskId ? `\ntask id: ${hit.taskId}` : ""}`,
            maxChars: 1_000,
          });
        })
        .join("\n");
    },
  }),
  tool({
    name: "add_comment",
    description:
      "Comment on a task. Use it to answer the person who asked you, or to report what you did.",
    risk: "write",
    requires: { task: ["update"] },
    schema: z
      .object({ task: taskRef, body: z.string().trim().min(1).max(10_000) })
      .strict(),
    async plan(ctx, args) {
      const task = await findTask(ctx, args.task);
      await assertPrincipalMay(ctx, task.projectId, { task: ["update"] });
      return {
        op: "comment",
        taskId: task.id,
        projectId: task.projectId,
        taskLabel: taskLabel(task),
        content: args.body,
      };
    },
  }),
  tool({
    name: "update_task",
    description:
      "Change a task's title, priority, due date (YYYY-MM-DD, or null to clear) or description (Markdown). Send only the fields to change.",
    risk: "write",
    requires: { task: ["update"] },
    schema: z
      .object({
        task: taskRef,
        title: z.string().trim().min(1).max(500).optional(),
        priority: z.enum(VALID_PRIORITIES).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        description: z.string().max(20_000).optional(),
      })
      .strict(),
    async plan(ctx, args) {
      const task = await findTask(ctx, args.task);
      await assertPrincipalMay(ctx, task.projectId, { task: ["update"] });
      const before: TaskFields = {};
      const after: TaskFields = {};
      if (args.title !== undefined && args.title !== task.title) {
        before.title = task.title;
        after.title = args.title;
      }
      if (args.priority !== undefined && args.priority !== task.priority) {
        before.priority = task.priority ?? "no-priority";
        after.priority = args.priority;
      }
      const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null;
      if (args.dueDate !== undefined && args.dueDate !== due) {
        before.dueDate = due;
        after.dueDate = args.dueDate;
      }
      if (
        args.description !== undefined &&
        args.description !== (task.description ?? "")
      ) {
        before.description = task.description ?? "";
        after.description = args.description;
      }
      if (Object.keys(after).length === 0) {
        throw new NothingToChange(
          "Nothing to change: the task already has these values.",
        );
      }
      return {
        op: "update_task",
        taskId: task.id,
        projectId: task.projectId,
        taskLabel: taskLabel(task),
        before,
        after,
      };
    },
  }),
  tool({
    name: "move_status",
    description: "Move a task to another status (column) of its project.",
    risk: "write",
    requires: { task: ["update"] },
    schema: z
      .object({ task: taskRef, status: z.string().trim().min(1).max(100) })
      .strict(),
    async plan(ctx, args) {
      const task = await findTask(ctx, args.task);
      await assertPrincipalMay(ctx, task.projectId, { task: ["update"] });
      const status = await assertColumn(task.projectId, args.status);
      if (status === task.status) {
        throw new NothingToChange(
          `Nothing to change: the task is already in ${status}.`,
        );
      }
      return {
        op: "set_status",
        taskId: task.id,
        projectId: task.projectId,
        taskLabel: taskLabel(task),
        before: { status: task.status },
        after: { status },
      };
    },
  }),
  tool({
    name: "create_subtask",
    description: "Create a sub-task under a task, unassigned.",
    risk: "write",
    requires: { task: ["create", "update"] },
    schema: z
      .object({
        parent: taskRef,
        title: z.string().trim().min(1).max(500),
        description: z.string().max(10_000).optional(),
      })
      .strict(),
    async plan(ctx, args) {
      const parent = await findTask(ctx, args.parent);
      await assertPrincipalMay(ctx, parent.projectId, {
        task: ["create", "update"],
      });
      return {
        op: "create_subtask",
        taskId: parent.id,
        projectId: parent.projectId,
        taskLabel: taskLabel(parent),
        title: args.title,
        description: args.description ?? "",
        status: parent.status,
      };
    },
  }),
  tool({
    name: "create_page",
    description:
      "Create a project page (a document, like a wiki page) with a title and Markdown content. Linked to the task when you give one; without a task it goes in the project (default: the project you work in). Use it for specs, summaries, reports, plans, notes and docs: long written work belongs on a page, not in a task description. Everyone in the project can read it.",
    risk: "write",
    requires: { page: ["create"] },
    schema: z
      .object({
        task: taskRef.optional(),
        project: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("A project id or key, for a page without a task"),
        title: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1).max(200_000),
      })
      .strict(),
    async plan(ctx, args) {
      if (!args.task) {
        const projectId = await findProjectId(
          ctx,
          args.project ?? ctx.projectId,
        );
        await assertPrincipalMay(ctx, projectId, { page: ["create"] });
        const [project] = await db
          .select({ name: projectTable.name })
          .from(projectTable)
          .where(eq(projectTable.id, projectId))
          .limit(1);
        return {
          op: "create_page",
          taskId: null,
          projectId,
          taskLabel: project?.name ?? "the project",
          title: args.title,
          content: args.content,
          taskKey: null,
          taskUrl: null,
        };
      }
      const task = await findTask(ctx, args.task);
      await assertPrincipalMay(ctx, task.projectId, { page: ["create"] });
      return {
        op: "create_page",
        taskId: task.id,
        projectId: task.projectId,
        taskLabel: taskLabel(task),
        title: args.title,
        content: args.content,
        taskKey: `${task.slug.toUpperCase()}-${task.number ?? 0}`,
        taskUrl: `/dashboard/workspace/${ctx.workspaceId}/project/${task.projectId}/task/${task.id}`,
      };
    },
  }),
  tool({
    name: "link_tasks",
    description:
      "Relate two tasks: blocks, blocked_by, related, duplicate (task is a duplicate of target), start_before, finish_before.",
    risk: "write",
    requires: { task: ["update"] },
    schema: z
      .object({
        task: taskRef,
        target: taskRef,
        relation: z.enum(
          RELATION_INPUT_NAMES.filter((name) => name !== "subtask") as [
            string,
            ...string[],
          ],
        ),
      })
      .strict(),
    async plan(ctx, args) {
      const source = await findTask(ctx, args.task);
      const target = await findTask(ctx, args.target);
      await assertPrincipalMay(ctx, source.projectId, { task: ["update"] });
      await assertPrincipalMay(ctx, target.projectId, { task: ["read"] });
      return {
        op: "link_tasks",
        taskId: source.id,
        projectId: source.projectId,
        taskLabel: taskLabel(source),
        targetTaskId: target.id,
        targetLabel: taskLabel(target),
        relationType: args.relation,
      };
    },
  }),
  tool({
    name: "delete_task",
    description:
      "Move a task to the trash. Always waits for a person's approval.",
    risk: "destructive",
    requires: { task: ["delete"] },
    schema: z.object({ task: taskRef }).strict(),
    async plan(ctx, args) {
      const task = await findTask(ctx, args.task);
      await assertPrincipalMay(ctx, task.projectId, { task: ["delete"] });
      return {
        op: "delete_task",
        taskId: task.id,
        projectId: task.projectId,
        taskLabel: taskLabel(task),
      };
    },
  }),
  tool({
    name: "bulk_move_status",
    description:
      "Move several tasks of one project to a status at once (up to 50). Always waits for a person's approval.",
    risk: "destructive",
    requires: { task: ["update"] },
    schema: z
      .object({
        tasks: z.array(taskRef).min(2).max(50),
        status: z.string().trim().min(1).max(100),
      })
      .strict(),
    async plan(ctx, args) {
      const tasks = [];
      for (const ref of new Set(args.tasks))
        tasks.push(await findTask(ctx, ref));
      const projectIds = new Set(tasks.map((task) => task.projectId));
      const [projectId] = projectIds;
      if (!projectId || projectIds.size > 1) {
        throw new ToolError("All tasks must be in one project");
      }
      await assertPrincipalMay(ctx, projectId, { task: ["update"] });
      const status = await assertColumn(projectId, args.status);
      const items = tasks
        .filter((task) => task.status !== status)
        .map((task) => ({
          taskId: task.id,
          projectId,
          taskLabel: taskLabel(task),
          before: task.status,
          after: status,
        }));
      if (items.length === 0) throw new ToolError("Nothing to move");
      return { op: "bulk_set_status", projectId, items };
    },
  }),
];

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((def) => def.name);

/** Questions one run may ask before it has to finish on its own. */
export const MAX_QUESTIONS = 3;

/**
 * Pauses the run until the person who asked answers (the runtime handles
 * it; it never reaches the API). The run resumes with the answer.
 */
export const ASK_PERSON: ToolDef = tool({
  name: "ask_person",
  description:
    "Ask the person you work for a question when you can't continue without their answer (a missing requirement, a choice only they can make). The run pauses until they reply, then continues with the answer. Offer up to 5 short options when the answer is a choice. Don't ask for things you can find with the other tools.",
  risk: "read",
  requires: {},
  schema: z
    .object({
      question: z.string().trim().min(1).max(1_000),
      options: z.array(z.string().trim().min(1).max(100)).max(5).optional(),
    })
    .strict(),
});

export function findTool(name: string): ToolDef | undefined {
  return AGENT_TOOLS.find((def) => def.name === name);
}

/** Tools the capped rights allow (read-only rights offer reads only). */
export function offeredTools(statements: PermissionMap): ToolDef[] {
  return AGENT_TOOLS.filter((def) => satisfies(statements, def.requires));
}

/** Provider-neutral tool definitions (JSON Schema, strict). */
export function chatTools(defs: ToolDef[]): ChatTool[] {
  return defs.map((def) => {
    if (def.jsonSchema) {
      return {
        name: def.name,
        description: def.description,
        inputSchema: def.jsonSchema,
      };
    }
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(
      def.schema,
    ) as Record<string, unknown>;
    return { name: def.name, description: def.description, inputSchema };
  });
}

/**
 * Step logs keep arguments short and redacted: emails, phone and card
 * numbers and secrets become placeholders, and long text is cut.
 */
export function redactArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const redactor = createRedactor();
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") {
      const text = redactor.redact(value);
      return text.length > 120
        ? `${text.slice(0, 120)}… (${value.length} characters)`
        : text;
    }
    if (Array.isArray(value)) return value.slice(0, 50).map(clean);
    return value;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) out[key] = clean(value);
  return out;
}

export type { ToolDef };
