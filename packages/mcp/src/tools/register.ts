import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { MargayaClient } from "../margaya/client.js";
import { buildFullTaskUpdateBody } from "../margaya/task-helpers.js";
import { errorResult, textResult } from "../utils/mcp-result.js";
import { mcpToolAnnotations } from "./annotations.js";
import { mcpToolOutputSchema } from "./output.js";
import { registerPlanningTools } from "./planning-tools.js";

const prioritySchema = z.enum([
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const nullableOptionalNonEmptyString = nonEmptyString.nullable().optional();
const assigneeIdsSchema = z
  .array(nonEmptyString)
  .max(20)
  .describe("Workspace member user IDs, first assignee first (at most 20)");
const isoDateTimeSchema = z.string().datetime({ offset: true });
const optionalIsoDateTimeSchema = isoDateTimeSchema.optional();
const nullableOptionalIsoDateTimeSchema = isoDateTimeSchema
  .nullable()
  .optional();
const hexColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    "Expected a hex color like #FF6600",
  );

// The task query engine's vocabulary (POST /api/task-query).
const GROUP_BY_KEYS = [
  "status",
  "group",
  "priority",
  "assignee",
  "createdBy",
  "label",
  "cycle",
  "module",
  "estimate",
  "project",
] as const;
const ORDER_BY_FIELDS = [
  "manual",
  "createdAt",
  "updatedAt",
  "completedAt",
  "startDate",
  "dueDate",
  "priority",
  "title",
  "number",
  "status",
  "assignee",
  "label",
  "cycle",
  "module",
  "estimate",
  "subTaskCount",
] as const;
const QUERY_INCLUDES = [
  "labels",
  "assignees",
  "cycle",
  "modules",
  "estimate",
  "subTasks",
  "customFields",
  "externalLinks",
] as const;

const queryTasksSchema = z.object({
  workspaceId: nonEmptyString,
  projectIds: z
    .array(nonEmptyString)
    .min(1)
    .max(100)
    .optional()
    .describe("Projects to search; omitted means every active project"),
  filters: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      "A condition { key, operator, values?, date?, from?, to?, amount?, unit?, fieldId? } or a group { op: 'and' | 'or', children }. Keys: status, group, priority, assignee, createdBy, label, cycle, module, estimate, project, parent, customField, startDate, dueDate, createdAt, updatedAt, completedAt.",
    ),
  archived: z.enum(["exclude", "include", "only"]).optional(),
  search: z.string().max(256).optional(),
  groupBy: z.enum(GROUP_BY_KEYS).optional(),
  subGroupBy: z.enum(GROUP_BY_KEYS).optional(),
  orderBy: z.enum(ORDER_BY_FIELDS).optional(),
  orderDirection: z.enum(["asc", "desc"]).optional(),
  include: z.array(z.enum(QUERY_INCLUDES)).optional(),
  mode: z.enum(["rows", "ids", "counts"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  group: optionalNonEmptyString.describe(
    "Load more of this group (all when ungrouped)",
  ),
  cursor: optionalNonEmptyString.describe("The group's nextCursor"),
  timeZone: optionalNonEmptyString.describe("IANA zone, default UTC"),
});

/** The flat tool input as a task query request body. */
export function buildTaskQueryBody(args: z.infer<typeof queryTasksSchema>) {
  return {
    workspaceId: args.workspaceId,
    scope: args.projectIds ? { projectIds: args.projectIds } : undefined,
    filters: args.filters,
    archived: args.archived,
    search: args.search,
    display: {
      groupBy: args.groupBy,
      subGroupBy: args.subGroupBy,
      orderBy: args.orderBy
        ? { field: args.orderBy, direction: args.orderDirection }
        : undefined,
    },
    include: args.include,
    mode: args.mode,
    page: { limit: args.limit, group: args.group, cursor: args.cursor },
    context: args.timeZone ? { timeZone: args.timeZone } : undefined,
  };
}

function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  return fn()
    .then((data) => textResult(data))
    .catch((e: unknown) =>
      errorResult(e instanceof Error ? e.message : String(e)),
    );
}

/** The server with each registration's annotations (and output schema) filled in by name. */
function withToolAnnotations(server: McpServer): McpServer {
  const register = server.registerTool.bind(server) as (
    name: string,
    config: Record<string, unknown>,
    callback: unknown,
  ) => unknown;
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") {
        return Reflect.get(target, property, receiver);
      }
      return (
        name: string,
        config: Record<string, unknown>,
        callback: unknown,
      ) =>
        register(
          name,
          {
            ...config,
            annotations: mcpToolAnnotations(name),
            // Declared only for tools with a stable shape (output.ts).
            ...(mcpToolOutputSchema(name)
              ? { outputSchema: mcpToolOutputSchema(name) }
              : {}),
          },
          callback,
        );
    },
  });
}

export function registerTools(
  mcpServer: McpServer,
  ctx: { client: MargayaClient },
): void {
  const { client } = ctx;
  // Every tool carries readOnlyHint / destructiveHint (annotations.ts).
  const server = withToolAnnotations(mcpServer);

  server.registerTool(
    "whoami",
    {
      description:
        "Return the current Margaya session and user for the cached device token.",
      inputSchema: z.object({}),
    },
    async () =>
      run(() => client.json("/api/auth/get-session", { method: "GET" })),
  );

  server.registerTool(
    "list_workspaces",
    {
      description:
        "List workspaces (Better Auth organizations) the signed-in user can access.",
      inputSchema: z.object({}),
    },
    async () =>
      run(() => client.json("/api/auth/organization/list", { method: "GET" })),
  );

  server.registerTool(
    "list_projects",
    {
      description:
        "List projects in a workspace. Each project includes its feature flags (cycles, modules, views, pages, intake, estimates, time tracking).",
      inputSchema: z.object({
        workspaceId: nonEmptyString.describe("Workspace ID"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived projects"),
      }),
    },
    async (args) => {
      const { workspaceId, includeArchived } = args;
      const qs = new URLSearchParams({ workspaceId });
      if (includeArchived === true) {
        qs.set("includeArchived", "true");
      }
      return run(() =>
        client.json(`/api/project?${qs.toString()}`, { method: "GET" }),
      );
    },
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Get a single project by ID, including its feature flags (cycles, modules, views, pages, intake, estimates, time tracking).",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/project/${encodeURIComponent(args.id)}`)),
  );

  server.registerTool(
    "create_project",
    {
      description: "Create a project in a workspace.",
      inputSchema: z.object({
        name: nonEmptyString,
        workspaceId: nonEmptyString,
        icon: nonEmptyString,
        slug: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/project", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            workspaceId: args.workspaceId,
            icon: args.icon,
            slug: args.slug,
          }),
        }),
      ),
  );

  server.registerTool(
    "update_project",
    {
      description:
        "Update project metadata, lead and default assignee (PATCH-style: only provided fields are changed).",
      inputSchema: z.object({
        id: nonEmptyString,
        name: optionalNonEmptyString,
        icon: z.string().optional(),
        slug: optionalNonEmptyString,
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
        leadUserId: nullableOptionalNonEmptyString.describe(
          "Project lead (a workspace member's user id); null clears it",
        ),
        defaultAssigneeUserId: nullableOptionalNonEmptyString.describe(
          "Default assignee for new tasks created without assignees (a workspace member's user id); null clears it",
        ),
      }),
    },
    async (args) => {
      const { id, ...patch } = args;
      return run(async () => {
        const existing = (await client.json(
          `/api/project/${encodeURIComponent(id)}`,
          { method: "GET" },
        )) as Record<string, unknown>;
        const name =
          patch.name ??
          (typeof existing.name === "string" ? existing.name : "");
        if (!name) {
          throw new Error("Cannot update project: missing name.");
        }
        const icon =
          patch.icon !== undefined
            ? patch.icon
            : typeof existing.icon === "string"
              ? existing.icon
              : "Layout";
        const slug =
          patch.slug ??
          (typeof existing.slug === "string" ? existing.slug : "");
        if (!slug) {
          throw new Error("Cannot update project: missing slug.");
        }
        const description =
          patch.description !== undefined
            ? patch.description
            : typeof existing.description === "string"
              ? existing.description
              : "";
        const isPublic =
          patch.isPublic !== undefined
            ? patch.isPublic
            : typeof existing.isPublic === "boolean"
              ? existing.isPublic
              : false;

        const body = {
          name,
          icon,
          slug,
          description,
          isPublic,
          ...(patch.leadUserId !== undefined
            ? { leadUserId: patch.leadUserId }
            : {}),
          ...(patch.defaultAssigneeUserId !== undefined
            ? { defaultAssigneeUserId: patch.defaultAssigneeUserId }
            : {}),
        };

        return client.json(`/api/project/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      });
    },
  );

  const listTasksSchema = z.object({
    projectId: nonEmptyString,
    status: optionalNonEmptyString,
    priority: prioritySchema.optional(),
    assigneeId: optionalNonEmptyString.describe(
      "Only tasks where this member is one of the assignees",
    ),
    page: z.number().int().min(1).max(1_000_000).optional(),
    relatedPage: z.number().int().min(1).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sortBy: z
      .enum(["createdAt", "priority", "dueDate", "position", "title", "number"])
      .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    dueBefore: optionalIsoDateTimeSchema,
    dueAfter: optionalIsoDateTimeSchema,
  });

  server.registerTool(
    "list_tasks",
    {
      description:
        "List a bounded page of tasks for a project (50 by default, maximum 100). Use pagination.totalPages and page to retrieve the rest; filters and sorting apply before pagination. For every task page, also follow relatedPage through pagination.relatedTotalPages for complete labels, links and column metadata.",
      inputSchema: listTasksSchema,
    },
    async (args) => {
      const { projectId, ...rest } = args;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined || v === null) {
          continue;
        }
        qs.set(k, String(v));
      }
      const q = qs.toString();
      const path = `/api/task/tasks/${encodeURIComponent(projectId)}${q ? `?${q}` : ""}`;
      return run(() => client.json(path, { method: "GET" }));
    },
  );

  server.registerTool(
    "query_tasks",
    {
      description:
        "Query tasks across a workspace's projects: an and/or filter tree, grouping, ordering and paging in one call. Set conditions use operator in / notIn with values (ids, 'none' for no value, 'me' for you); date conditions compare days in timeZone. Returns groups (task ids and exact counts), tasks by id and lookups; mode ids returns every matching id, counts only the counts. Load more of one group with group and its nextCursor.",
      inputSchema: queryTasksSchema,
    },
    async (args) =>
      run(() =>
        client.json("/api/task-query", {
          method: "POST",
          body: JSON.stringify(buildTaskQueryBody(args)),
        }),
      ),
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task by ID.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/${encodeURIComponent(args.taskId)}`, {
          method: "GET",
        }),
      ),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create a task in a project. Without assigneeIds and userId the project's default assignee (if any) is assigned; pass assigneeIds: [] for an unassigned task.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        title: nonEmptyString,
        description: z.string(),
        priority: prioritySchema,
        status: nonEmptyString,
        startDate: optionalIsoDateTimeSchema,
        dueDate: optionalIsoDateTimeSchema,
        assigneeIds: assigneeIdsSchema.optional(),
        userId: optionalNonEmptyString.describe(
          "Single assignee; assigneeIds takes precedence",
        ),
        parentId: optionalNonEmptyString.describe(
          "Create the task as a subtask of this task (same project)",
        ),
      }),
    },
    async (args) => {
      const body: Record<string, string | string[] | undefined> = {
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
      };
      if (args.startDate !== undefined) {
        body.startDate = args.startDate;
      }
      if (args.dueDate !== undefined) {
        body.dueDate = args.dueDate;
      }
      if (args.assigneeIds !== undefined) {
        body.assigneeIds = args.assigneeIds;
      } else if (args.userId !== undefined) {
        body.userId = args.userId;
      }
      if (args.parentId !== undefined) {
        body.parentId = args.parentId;
      }
      return run(() =>
        client.json(`/api/task/${encodeURIComponent(args.projectId)}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    },
  );

  const updateTaskSchema = z.object({
    taskId: nonEmptyString,
    title: optionalNonEmptyString,
    description: z.string().nullable().optional(),
    status: optionalNonEmptyString,
    priority: prioritySchema.optional(),
    projectId: optionalNonEmptyString,
    position: z.number().optional(),
    startDate: nullableOptionalIsoDateTimeSchema,
    dueDate: nullableOptionalIsoDateTimeSchema,
    assigneeIds: assigneeIdsSchema
      .nullable()
      .optional()
      .describe(
        "Replaces every assignee; null or [] clears them. Omit to keep them.",
      ),
    userId: nullableOptionalNonEmptyString.describe(
      "Single assignee: another member replaces every assignee, null clears them",
    ),
  });

  server.registerTool(
    "update_task",
    {
      description:
        "Update a task (fetches current task, merges fields, then full update).",
      inputSchema: updateTaskSchema,
    },
    async (args) => {
      const { taskId, ...patch } = args;
      return run(async () => {
        const existing = (await client.json(
          `/api/task/${encodeURIComponent(taskId)}`,
          { method: "GET" },
        )) as Record<string, unknown>;
        const body = buildFullTaskUpdateBody(existing, patch);
        return client.json(`/api/task/${encodeURIComponent(taskId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      });
    },
  );

  server.registerTool(
    "move_task",
    {
      description:
        "Move a task to another project (and optional column status).",
      inputSchema: z.object({
        taskId: nonEmptyString,
        destinationProjectId: nonEmptyString,
        destinationStatus: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/move/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({
            destinationProjectId: args.destinationProjectId,
            ...(args.destinationStatus !== undefined
              ? { destinationStatus: args.destinationStatus }
              : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "update_task_status",
    {
      description: "Update only the status (column) of a task.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        status: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/status/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({ status: args.status }),
        }),
      ),
  );

  server.registerTool(
    "list_task_comments",
    {
      description:
        "List comments on a task, oldest first. Replies carry the parentId of their thread's top-level comment.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.taskId)}`, {
          method: "GET",
        }),
      ),
  );

  server.registerTool(
    "create_task_comment",
    {
      description:
        "Add a comment to a task. Pass parentId (a comment id from list_task_comments) to reply in that comment's thread; a reply to a reply joins its top-level comment's thread.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        content: nonEmptyString,
        parentId: nonEmptyString.max(128).optional(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.taskId)}`, {
          method: "POST",
          body: JSON.stringify({
            content: args.content,
            ...(args.parentId ? { parentId: args.parentId } : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "update_task_comment",
    {
      description: "Update one of your comments on a task.",
      inputSchema: z.object({
        commentId: nonEmptyString,
        content: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.commentId)}`, {
          method: "PUT",
          body: JSON.stringify({ content: args.content }),
        }),
      ),
  );

  server.registerTool(
    "delete_task_comment",
    {
      description: "Delete one of your comments from a task.",
      inputSchema: z.object({ commentId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/comment/${encodeURIComponent(args.commentId)}`, {
          method: "DELETE",
        }),
      ),
  );

  server.registerTool(
    "list_workspace_labels",
    {
      description: "List labels defined in a workspace.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/label/workspace/${encodeURIComponent(args.workspaceId)}`,
          { method: "GET" },
        ),
      ),
  );

  server.registerTool(
    "create_label",
    {
      description:
        "Create a label in a workspace (optionally attach to a task).",
      inputSchema: z.object({
        name: nonEmptyString,
        color: hexColorSchema,
        workspaceId: nonEmptyString,
        taskId: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/label", {
          method: "POST",
          body: JSON.stringify({
            name: args.name,
            color: args.color,
            workspaceId: args.workspaceId,
            ...(args.taskId !== undefined ? { taskId: args.taskId } : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "attach_label_to_task",
    {
      description: "Attach an existing label to a task.",
      inputSchema: z.object({
        labelId: nonEmptyString,
        taskId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/label/${encodeURIComponent(args.labelId)}/task`, {
          method: "PUT",
          body: JSON.stringify({ taskId: args.taskId }),
        }),
      ),
  );

  server.registerTool(
    "detach_label_from_task",
    {
      description: "Detach a label from its current task.",
      inputSchema: z.object({ labelId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/label/${encodeURIComponent(args.labelId)}/task`, {
          method: "DELETE",
        }),
      ),
  );

  server.registerTool(
    "create_task_relation",
    {
      description:
        "Create a relation between two tasks of a workspace (they may be in different projects). relationType: 'subtask' (sourceTaskId is the parent of targetTaskId; same project, one parent per task), 'blocks' or 'blocking' (sourceTaskId blocks targetTaskId), 'blocked_by' (sourceTaskId is blocked by targetTaskId), 'related', 'duplicate' (sourceTaskId is a duplicate of targetTaskId), 'start_before' / 'start_after' (sourceTaskId starts before / after targetTaskId), 'finish_before' / 'finish_after' (sourceTaskId finishes before / after targetTaskId). Inverse names are stored flipped, so the returned row may swap the ids. Two tasks share at most one non-subtask relation.",
      inputSchema: z.object({
        sourceTaskId: nonEmptyString,
        targetTaskId: nonEmptyString,
        relationType: z.enum([
          "subtask",
          "blocks",
          "blocking",
          "blocked_by",
          "related",
          "duplicate",
          "start_before",
          "start_after",
          "finish_before",
          "finish_after",
        ]),
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/task-relation", {
          method: "POST",
          body: JSON.stringify({
            sourceTaskId: args.sourceTaskId,
            targetTaskId: args.targetTaskId,
            relationType: args.relationType,
          }),
        }),
      ),
  );

  server.registerTool(
    "get_task_relations",
    {
      description:
        "List all relations involving a task, oldest first. relationType is the stored type (source → target): subtask (source is the parent), blocks, related, duplicate, start_before or finish_before.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-relation/${encodeURIComponent(args.taskId)}`, {
          method: "GET",
        }),
      ),
  );

  server.registerTool(
    "set_task_parent",
    {
      description:
        "Set, change or clear a task's parent in one step. parentTaskId must be a task of the same project that is not one of the task's own subtasks; null removes the parent.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        parentTaskId: nonEmptyString.nullable(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/task-relation/parent/${encodeURIComponent(args.taskId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ parentTaskId: args.parentTaskId }),
          },
        ),
      ),
  );

  server.registerTool(
    "delete_task_relation",
    {
      description: "Delete a task relation by its relation ID.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-relation/${encodeURIComponent(args.id)}`, {
          method: "DELETE",
        }),
      ),
  );

  server.registerTool(
    "delete_label",
    {
      description:
        "Delete a label by ID. Only task-associated labels can be deleted; workspace-level labels (taskId null) are rejected by the API.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(async () => {
        const label = (await client.json(
          `/api/label/${encodeURIComponent(args.id)}`,
          { method: "GET" },
        )) as { taskId?: string | null };
        if (!label?.taskId) {
          throw new Error(
            "Label is not associated with a task and cannot be deleted (workspace-level labels are not deletable via this endpoint).",
          );
        }
        return client.json(`/api/label/${encodeURIComponent(args.id)}`, {
          method: "DELETE",
        });
      }),
  );

  server.registerTool(
    "list_workspace_members",
    {
      description:
        "List the members of a workspace. Use this to resolve the user ID an assignee tool expects.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/workspace/${encodeURIComponent(args.workspaceId)}/members`,
        ),
      ),
  );

  server.registerTool(
    "search",
    {
      description:
        'Ranked full-text search across tasks, projects, workspaces, comments, activities, pages, cycles, modules, saved views and intake requests. Supports "quoted phrases", or and -exclude; the last word also matches as a prefix, and an exact task key (WEB-12) comes first. Task, comment and page results include a highlighted snippet.',
      inputSchema: z.object({
        q: nonEmptyString.describe("Search query"),
        type: z
          .enum([
            "all",
            "tasks",
            "projects",
            "workspaces",
            "comments",
            "activities",
            "pages",
            "cycles",
            "modules",
            "views",
            "intake",
          ])
          .optional()
          .describe("Restrict results to one kind. Defaults to all."),
        workspaceId: optionalNonEmptyString.describe("Limit to one workspace"),
        projectId: optionalNonEmptyString.describe("Limit to one project"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum results, 1 to 50. Defaults to 20."),
      }),
    },
    async (args) => {
      const qs = new URLSearchParams({ q: args.q });
      if (args.type) qs.set("type", args.type);
      if (args.workspaceId) qs.set("workspaceId", args.workspaceId);
      if (args.projectId) qs.set("projectId", args.projectId);
      if (args.limit !== undefined) qs.set("limit", String(args.limit));
      return run(() => client.json(`/api/search?${qs.toString()}`));
    },
  );

  server.registerTool(
    "list_project_columns",
    {
      description:
        "List a project's columns. Their slugs are the values update_task_status and create_task accept as a status.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/column/${encodeURIComponent(args.projectId)}`),
      ),
  );

  server.registerTool(
    "delete_task",
    {
      description:
        "Move a task, with its sub-tasks, to the project's trash. It disappears everywhere but can be brought back with restore_task until it is deleted permanently (after the instance's trash retention, 30 days by default).",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/${encodeURIComponent(args.taskId)}`, {
          method: "DELETE",
        }),
      ),
  );

  server.registerTool(
    "restore_task",
    {
      description:
        "Bring a task back from the trash, with the sub-tasks deleted together with it, into its column (or the project's entry column when that column is gone). Fails while the task's project is itself in the trash.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/trash/task/${encodeURIComponent(args.taskId)}/restore`,
          { method: "POST" },
        ),
      ),
  );

  server.registerTool(
    "update_task_assignee",
    {
      description:
        "Replace all of a task's assignees with one workspace member, or pass null to clear them. To keep the others, use update_task_assignees.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        userId: nonEmptyString
          .nullable()
          .describe("Member user ID, or null to unassign"),
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/assignee/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({ userId: args.userId }),
        }),
      ),
  );

  server.registerTool(
    "set_task_assignees",
    {
      description:
        "Set a task's complete list of assignees (workspace member user IDs). People who stay keep their order; new people are added at the end. Pass an empty list to unassign everyone.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        assigneeIds: assigneeIdsSchema,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/assignees/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify({ assigneeIds: args.assigneeIds }),
        }),
      ),
  );

  server.registerTool(
    "update_task_assignees",
    {
      description:
        "Add and/or remove assignees of a task without touching the others. Adding someone already assigned, or removing someone who isn't, does nothing.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        add: assigneeIdsSchema.optional().describe("Member user IDs to add"),
        remove: assigneeIdsSchema
          .optional()
          .describe("Member user IDs to remove"),
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/assignees/${encodeURIComponent(args.taskId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...(args.add ? { add: args.add } : {}),
            ...(args.remove ? { remove: args.remove } : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "update_task_due_date",
    {
      description: "Set a task's due date. Omit dueDate to clear it.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        dueDate: optionalIsoDateTimeSchema,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task/due-date/${encodeURIComponent(args.taskId)}`, {
          method: "PUT",
          body: JSON.stringify(
            args.dueDate === undefined ? {} : { dueDate: args.dueDate },
          ),
        }),
      ),
  );

  server.registerTool(
    "list_task_time_entries",
    {
      description: "List the time entries logged against a task.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/time-entry/task/${encodeURIComponent(args.taskId)}`),
      ),
  );

  server.registerTool(
    "get_time_entry",
    {
      description: "Get a single time entry by ID.",
      inputSchema: z.object({ id: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/time-entry/${encodeURIComponent(args.id)}`)),
  );

  server.registerTool(
    "create_time_entry",
    {
      description:
        "Log time against a task. Omit endTime to leave the entry running; a person has one running entry at a time, so this stops any other they have running.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        startTime: isoDateTimeSchema,
        endTime: optionalIsoDateTimeSchema,
        description: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json("/api/time-entry", {
          method: "POST",
          body: JSON.stringify({
            taskId: args.taskId,
            startTime: args.startTime,
            ...(args.endTime ? { endTime: args.endTime } : {}),
            ...(args.description ? { description: args.description } : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "update_time_entry",
    {
      description:
        "Update a time entry. startTime is required; omitting endTime keeps the stored one. startTime cannot be later than the end time.",
      inputSchema: z.object({
        id: nonEmptyString,
        startTime: isoDateTimeSchema,
        endTime: optionalIsoDateTimeSchema,
        description: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/time-entry/${encodeURIComponent(args.id)}`, {
          method: "PUT",
          body: JSON.stringify({
            startTime: args.startTime,
            ...(args.endTime ? { endTime: args.endTime } : {}),
            ...(args.description ? { description: args.description } : {}),
          }),
        }),
      ),
  );

  server.registerTool(
    "list_task_activity",
    {
      description: "List a task's activity history.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/activity/${encodeURIComponent(args.taskId)}`),
      ),
  );

  server.registerTool(
    "list_notifications",
    {
      description: "List the signed-in user's notifications.",
      inputSchema: z.object({}),
    },
    async () => run(() => client.json("/api/notification")),
  );

  // Margaya agents: the same names, inputs and API calls as the HTTP server.
  // Only the HTTP server answers run_agent with an MCP Tasks handle.
  server.registerTool(
    "list_agents",
    {
      description:
        "List a workspace's Margaya agents (AI teammates) with their id, name, role and whether they are on. Needs AI to be on for the workspace.",
      inputSchema: z.object({ workspaceId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/ai/agents?workspaceId=${encodeURIComponent(args.workspaceId)}`,
        ),
      ),
  );

  server.registerTool(
    "run_agent",
    {
      description:
        "Start a Margaya agent on a task with instructions. The run works with at most your rights; risky changes wait for your approval. Returns the run (id, status): follow it with get_agent_run. On the HTTP endpoint (/api/mcp), a client that supports the MCP Tasks extension gets a task handle instead, and answers approvals and questions through tasks/update.",
      inputSchema: z.object({
        workspaceId: nonEmptyString,
        agentId: nonEmptyString,
        taskId: nonEmptyString.describe("The task the agent works on"),
        prompt: z.string().trim().min(1).max(4_000),
      }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/ai/agents/${encodeURIComponent(args.agentId)}/runs`, {
          method: "POST",
          body: JSON.stringify({
            workspaceId: args.workspaceId,
            taskId: args.taskId,
            prompt: args.prompt,
          }),
        }),
      ),
  );

  server.registerTool(
    "get_agent_run",
    {
      description:
        "Get an agent run: status (queued, running, awaiting_approval, needs_input, succeeded, failed, cancelled), the agent's question while it needs input, its summary, and every step with its change and approval state.",
      inputSchema: z.object({
        workspaceId: nonEmptyString,
        runId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/ai/agents/runs/${encodeURIComponent(args.runId)}?workspaceId=${encodeURIComponent(args.workspaceId)}`,
        ),
      ),
  );

  // Cycles, modules and intake (B13 K27): the same file as the API server's.
  // The SDK's overloads don't resolve for a generic schema; this is the shape
  // the planning tools rely on (the SDK validates the arguments first).
  const toolServer = server as unknown as {
    registerTool(
      name: string,
      config: { description: string; inputSchema: z.ZodObject },
      callback: (args: unknown) => Promise<CallToolResult>,
    ): unknown;
  };
  registerPlanningTools<CallToolResult>({
    register: (name, config, callback) =>
      toolServer.registerTool(name, config, (args) => callback(args as never)),
    client,
    run,
    fail: errorResult,
  });
}
