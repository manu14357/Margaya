import { z } from "zod";

// Cycle, module, page, intake, task template and task repeat tools (B13 K27). This file is kept byte-identical
// in apps/api/src/mcp/planning-tools.ts (the HTTP MCP server) and
// packages/mcp/src/tools/planning-tools.ts (the stdio package); it depends on
// zod only, and each catalog adapts its own registrar, client and results.

type JsonClient = {
  json(path: string, init?: RequestInit): Promise<unknown>;
};

/** Registers one tool; the callback receives arguments parsed by the schema. */
export type PlanningToolRegistrar<Result> = <Schema extends z.ZodObject>(
  name: string,
  config: { description: string; inputSchema: Schema },
  callback: (args: z.output<Schema>) => Promise<Result>,
) => unknown;

export type PlanningToolAdapters<Result> = {
  register: PlanningToolRegistrar<Result>;
  client: JsonClient;
  /** Runs one API call and wraps its JSON (or its error) as a tool result. */
  run: (fn: () => Promise<unknown>) => Promise<Result>;
  /** A tool-side validation error, reported without calling the API. */
  fail: (message: string) => Result;
};

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = nonEmptyString.optional();

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** A calendar day, YYYY-MM-DD, with no time zone. */
const dateOnlySchema = z
  .string()
  .refine(isCalendarDate, "Use a real calendar date in YYYY-MM-DD form");
const nullableOptionalDateOnly = dateOnlySchema.nullable().optional();
/** 1-200 task ids; duplicates are dropped before the call. */
const taskIdListSchema = z
  .array(nonEmptyString)
  .min(1)
  .max(200)
  .describe("Task IDs (1 to 200)");
const moduleStatusSchema = z.enum([
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
]);
const prioritySchema = z.enum([
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

const id = (value: string) => encodeURIComponent(value);

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function withQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

/** Drops undefined keys so a patch only carries what the caller set. */
function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function registerCycleTools<Result>({
  register,
  client,
  run,
  fail,
}: PlanningToolAdapters<Result>) {
  register(
    "list_cycles",
    {
      description:
        "List a project's cycles with status, dates, task counts and progress.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        view: z
          .enum([
            "all",
            "current",
            "upcoming",
            "draft",
            "completed",
            "incomplete",
            "archived",
          ])
          .optional(),
        search: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          withQuery(`/api/cycle/project/${id(args.projectId)}`, {
            view: args.view,
            search: args.search,
          }),
        ),
      ),
  );

  register(
    "get_cycle",
    {
      description:
        "Get a cycle. With includeProgress, also its progress: the burndown series and breakdowns by assignee, label and priority. Returns { cycle, progress? }.",
      inputSchema: z.object({
        cycleId: nonEmptyString,
        includeProgress: z.boolean().optional(),
      }),
    },
    async (args) =>
      run(async () => {
        const cycle = await client.json(`/api/cycle/${id(args.cycleId)}`);
        if (!args.includeProgress) return { cycle };
        const progress = await client.json(
          `/api/cycle/${id(args.cycleId)}/progress`,
        );
        return { cycle, progress };
      }),
  );

  register(
    "create_cycle",
    {
      description:
        "Create a cycle in a project. Dates are calendar days (YYYY-MM-DD); give both or neither. Overlapping another cycle is refused by the API.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        name: nonEmptyString,
        startDate: dateOnlySchema.optional(),
        endDate: dateOnlySchema.optional(),
        ownerId: optionalNonEmptyString,
      }),
    },
    async (args) => {
      if ((args.startDate === undefined) !== (args.endDate === undefined)) {
        return fail("Provide both startDate and endDate, or neither.");
      }
      return run(() =>
        client.json(
          `/api/cycle/project/${id(args.projectId)}`,
          jsonBody(
            "POST",
            defined({
              name: args.name,
              startDate: args.startDate,
              endDate: args.endDate,
              ownerId: args.ownerId,
            }),
          ),
        ),
      );
    },
  );

  register(
    "update_cycle",
    {
      description:
        "Change a cycle's name, dates or owner; only the fields you pass change. Dates are sent together (null clears both); ownerId null removes the owner.",
      inputSchema: z.object({
        cycleId: nonEmptyString,
        name: optionalNonEmptyString,
        startDate: nullableOptionalDateOnly,
        endDate: nullableOptionalDateOnly,
        ownerId: nonEmptyString.nullable().optional(),
      }),
    },
    async (args) => {
      const patch = defined({
        name: args.name,
        startDate: args.startDate,
        endDate: args.endDate,
        ownerId: args.ownerId,
      });
      if (Object.keys(patch).length === 0) {
        return fail("Provide at least one field to change.");
      }
      if ((args.startDate === undefined) !== (args.endDate === undefined)) {
        return fail("Provide both startDate and endDate, or neither.");
      }
      return run(() =>
        client.json(`/api/cycle/${id(args.cycleId)}`, jsonBody("PUT", patch)),
      );
    },
  );

  register(
    "delete_cycle",
    {
      description:
        "Delete a cycle. Its tasks stay in the project. Destructive.",
      inputSchema: z.object({ cycleId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/cycle/${id(args.cycleId)}`, { method: "DELETE" }),
      ),
  );

  register(
    "set_cycle_archived",
    {
      description:
        "Archive or restore a cycle. Only completed cycles can be archived.",
      inputSchema: z.object({
        cycleId: nonEmptyString,
        archived: z.boolean(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/cycle/${id(args.cycleId)}/${args.archived ? "archive" : "unarchive"}`,
          { method: "POST" },
        ),
      ),
  );

  register(
    "update_cycle_tasks",
    {
      description:
        "Add tasks to a cycle and/or take tasks out of it. A task can be in only one cycle; adding moves it from its previous cycle. Returns { added?, removed? }.",
      inputSchema: z.object({
        cycleId: nonEmptyString,
        addTaskIds: taskIdListSchema.optional(),
        removeTaskIds: taskIdListSchema.optional(),
      }),
    },
    async (args) => {
      if (!args.addTaskIds && !args.removeTaskIds) {
        return fail("Provide addTaskIds, removeTaskIds or both.");
      }
      return run(async () => {
        const path = `/api/cycle/${id(args.cycleId)}/tasks`;
        const result: Record<string, unknown> = {};
        if (args.addTaskIds) {
          result.added = await client.json(
            path,
            jsonBody("POST", { taskIds: unique(args.addTaskIds) }),
          );
        }
        if (args.removeTaskIds) {
          result.removed = await client.json(
            path,
            jsonBody("DELETE", { taskIds: unique(args.removeTaskIds) }),
          );
        }
        return result;
      });
    },
  );

  register(
    "set_task_cycle",
    {
      description:
        "Put a task in a cycle, or pass null to take it out of its cycle.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        cycleId: nonEmptyString.nullable(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/cycle/task/${id(args.taskId)}`,
          jsonBody("PUT", { cycleId: args.cycleId }),
        ),
      ),
  );

  register(
    "transfer_cycle_tasks",
    {
      description:
        "Move unfinished tasks from a completed cycle to another cycle, and freeze the source's report.",
      inputSchema: z.object({
        cycleId: nonEmptyString,
        targetCycleId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/cycle/${id(args.cycleId)}/transfer`,
          jsonBody("POST", { targetCycleId: args.targetCycleId }),
        ),
      ),
  );
}

function registerModuleTools<Result>({
  register,
  client,
  run,
  fail,
}: PlanningToolAdapters<Result>) {
  register(
    "list_modules",
    {
      description:
        "List a project's modules with status, lead, dates and progress.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        view: z.enum(["active", "archived"]).optional(),
        status: z.array(moduleStatusSchema).optional(),
        leadId: optionalNonEmptyString,
        search: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          withQuery(`/api/module/project/${id(args.projectId)}`, {
            view: args.view,
            status: args.status?.join(","),
            leadId: args.leadId,
            search: args.search,
          }),
        ),
      ),
  );

  register(
    "get_module",
    {
      description:
        "Get a module with its links and members. With includeProgress, also its progress. Returns { module, progress? }.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        includeProgress: z.boolean().optional(),
      }),
    },
    async (args) =>
      run(async () => {
        const module = await client.json(`/api/module/${id(args.moduleId)}`);
        if (!args.includeProgress) return { module };
        const progress = await client.json(
          `/api/module/${id(args.moduleId)}/progress`,
        );
        return { module, progress };
      }),
  );

  register(
    "create_module",
    {
      description:
        "Create a module in a project. Dates are calendar days (YYYY-MM-DD).",
      inputSchema: z.object({
        projectId: nonEmptyString,
        name: nonEmptyString,
        description: z.string().optional(),
        status: moduleStatusSchema.optional(),
        startDate: dateOnlySchema.optional(),
        targetDate: dateOnlySchema.optional(),
        leadId: optionalNonEmptyString,
        memberIds: z.array(nonEmptyString).max(100).optional(),
      }),
    },
    async (args) => {
      if (
        args.startDate &&
        args.targetDate &&
        args.startDate > args.targetDate
      ) {
        return fail("startDate must be on or before targetDate.");
      }
      return run(() =>
        client.json(
          `/api/module/project/${id(args.projectId)}`,
          jsonBody(
            "POST",
            defined({
              name: args.name,
              description: args.description,
              status: args.status,
              startDate: args.startDate,
              targetDate: args.targetDate,
              leadId: args.leadId,
              memberIds: args.memberIds,
            }),
          ),
        ),
      );
    },
  );

  register(
    "update_module",
    {
      description:
        "Change a module; only the fields you pass change, and null clears a description, date or lead. memberIds replaces the whole member list.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        name: optionalNonEmptyString,
        description: z.string().nullable().optional(),
        status: moduleStatusSchema.optional(),
        startDate: nullableOptionalDateOnly,
        targetDate: nullableOptionalDateOnly,
        leadId: nonEmptyString.nullable().optional(),
        memberIds: z.array(nonEmptyString).max(100).optional(),
      }),
    },
    async (args) => {
      const patch = defined({
        name: args.name,
        description: args.description,
        status: args.status,
        startDate: args.startDate,
        targetDate: args.targetDate,
        leadId: args.leadId,
        memberIds: args.memberIds,
      });
      if (Object.keys(patch).length === 0) {
        return fail("Provide at least one field to change.");
      }
      return run(() =>
        client.json(`/api/module/${id(args.moduleId)}`, jsonBody("PUT", patch)),
      );
    },
  );

  register(
    "delete_module",
    {
      description: "Delete a module. Tasks stay in the project. Destructive.",
      inputSchema: z.object({ moduleId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/module/${id(args.moduleId)}`, { method: "DELETE" }),
      ),
  );

  register(
    "set_module_archived",
    {
      description:
        "Archive or restore a module. Only completed or cancelled modules can be archived. An archived module can't be edited until it is restored.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        archived: z.boolean(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/module/${id(args.moduleId)}/${args.archived ? "archive" : "unarchive"}`,
          { method: "POST" },
        ),
      ),
  );

  register(
    "list_module_tasks",
    {
      description:
        "List a module's tasks, a page at a time, with key fields; follow pagination.totalPages.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          withQuery(`/api/module/${id(args.moduleId)}/tasks`, {
            page: args.page,
            limit: args.limit,
          }),
        ),
      ),
  );

  register(
    "update_module_tasks",
    {
      description:
        "Add tasks to a module and/or take tasks out of it. A task can be in several modules. Returns { added?, removed? }.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        addTaskIds: taskIdListSchema.optional(),
        removeTaskIds: taskIdListSchema.optional(),
      }),
    },
    async (args) => {
      if (!args.addTaskIds && !args.removeTaskIds) {
        return fail("Provide addTaskIds, removeTaskIds or both.");
      }
      return run(async () => {
        const path = `/api/module/${id(args.moduleId)}/tasks`;
        const result: Record<string, unknown> = {};
        if (args.addTaskIds) {
          result.added = await client.json(
            path,
            jsonBody("POST", { taskIds: unique(args.addTaskIds) }),
          );
        }
        if (args.removeTaskIds) {
          result.removed = await client.json(
            path,
            jsonBody("DELETE", { taskIds: unique(args.removeTaskIds) }),
          );
        }
        return result;
      });
    },
  );

  register(
    "set_task_modules",
    {
      description:
        "Put a task in modules and/or take it out of modules (up to 100 each). Returns the task's modules after the change.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        addModuleIds: z.array(nonEmptyString).max(100).optional(),
        removeModuleIds: z.array(nonEmptyString).max(100).optional(),
      }),
    },
    async (args) => {
      if (!args.addModuleIds?.length && !args.removeModuleIds?.length) {
        return fail("Provide addModuleIds, removeModuleIds or both.");
      }
      return run(() =>
        client.json(
          `/api/module/task/${id(args.taskId)}`,
          jsonBody(
            "PUT",
            defined({
              addModuleIds: args.addModuleIds,
              removeModuleIds: args.removeModuleIds,
            }),
          ),
        ),
      );
    },
  );

  register(
    "add_module_link",
    {
      description:
        "Add a web link to a module. https:// is assumed without a scheme.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        url: nonEmptyString,
        title: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/module/${id(args.moduleId)}/links`,
          jsonBody("POST", defined({ url: args.url, title: args.title })),
        ),
      ),
  );

  register(
    "delete_module_link",
    {
      description: "Remove a link from a module.",
      inputSchema: z.object({
        moduleId: nonEmptyString,
        linkId: nonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/module/${id(args.moduleId)}/links/${id(args.linkId)}`,
          { method: "DELETE" },
        ),
      ),
  );
}

const TRIAGE_ACTIONS = [
  "accept",
  "decline",
  "snooze",
  "unsnooze",
  "duplicate",
  "reopen",
] as const;

type TriageArgs = {
  action: (typeof TRIAGE_ACTIONS)[number];
  status?: string;
  note?: string;
  until?: string;
  duplicateOfTaskId?: string;
};

/** The body an action takes, or why it can't be sent. Never extra fields. */
function triageBody(
  args: TriageArgs,
  now: number,
): { body?: Record<string, unknown> } | { error: string } {
  switch (args.action) {
    case "accept":
      if (!args.status) {
        return {
          error: "action accept needs status (a column slug or planned)",
        };
      }
      return { body: { status: args.status } };
    case "decline":
      return { body: defined({ note: args.note }) };
    case "snooze":
      if (!args.until) return { error: "action snooze needs until" };
      if (Date.parse(args.until) <= now) {
        return { error: "action snooze needs an until in the future" };
      }
      return { body: { until: args.until } };
    case "duplicate":
      if (!args.duplicateOfTaskId) {
        return { error: "action duplicate needs duplicateOfTaskId" };
      }
      return {
        body: defined({
          duplicateOfTaskId: args.duplicateOfTaskId,
          note: args.note,
        }),
      };
    default:
      return {};
  }
}

function registerIntakeTools<Result>({
  register,
  client,
  run,
  fail,
}: PlanningToolAdapters<Result>) {
  register(
    "list_intake_items",
    {
      description:
        "List a project's intake requests you can see. With only submit permission you see your own requests.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        tab: z.enum(["open", "closed"]).optional(),
        status: z
          .array(
            z.enum(["pending", "snoozed", "accepted", "declined", "duplicate"]),
          )
          .optional(),
        priority: z.array(prioritySchema).optional(),
        search: optionalNonEmptyString,
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          withQuery(`/api/intake/project/${id(args.projectId)}`, {
            tab: args.tab,
            status: args.status?.join(","),
            priority: args.priority?.join(","),
            search: args.search,
            page: args.page,
            limit: args.limit,
          }),
        ),
      ),
  );

  register(
    "get_intake_item",
    {
      description:
        "Get an intake request. Use get_task with its task id for the full description.",
      inputSchema: z.object({ intakeItemId: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/intake/item/${id(args.intakeItemId)}`)),
  );

  register(
    "submit_intake_item",
    {
      description:
        "Submit a request to a project's intake queue. The project must have Intake turned on.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        title: nonEmptyString,
        description: z.string().optional(),
        priority: prioritySchema.optional(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/intake/project/${id(args.projectId)}`,
          jsonBody(
            "POST",
            defined({
              title: args.title,
              description: args.description,
              priority: args.priority,
            }),
          ),
        ),
      ),
  );

  register(
    "update_intake_item",
    {
      description:
        "Edit an intake request's title, description or priority. Submitters can edit their own open requests.",
      inputSchema: z.object({
        intakeItemId: nonEmptyString,
        title: optionalNonEmptyString,
        description: z.string().optional(),
        priority: prioritySchema.optional(),
      }),
    },
    async (args) => {
      const patch = defined({
        title: args.title,
        description: args.description,
        priority: args.priority,
      });
      if (Object.keys(patch).length === 0) {
        return fail("Provide at least one field to change.");
      }
      return run(() =>
        client.json(
          `/api/intake/item/${id(args.intakeItemId)}`,
          jsonBody("PATCH", patch),
        ),
      );
    },
  );

  register(
    "triage_intake_item",
    {
      description:
        "Triage an intake request: accept (needs status, a column slug or planned), decline (optional note), snooze (needs a future until, ISO date-time with offset), unsnooze, duplicate (needs duplicateOfTaskId, optional note) or reopen.",
      inputSchema: z.object({
        intakeItemId: nonEmptyString,
        action: z.enum(TRIAGE_ACTIONS),
        status: optionalNonEmptyString,
        note: z.string().max(2000).optional(),
        until: z.string().datetime({ offset: true }).optional(),
        duplicateOfTaskId: optionalNonEmptyString,
      }),
    },
    async (args) => {
      const planned = triageBody(args, Date.now());
      if ("error" in planned) return fail(planned.error);
      return run(() =>
        client.json(
          `/api/intake/item/${id(args.intakeItemId)}/${args.action}`,
          planned.body ? jsonBody("POST", planned.body) : { method: "POST" },
        ),
      );
    },
  );

  register(
    "delete_intake_item",
    {
      description:
        "Withdraw or delete an intake request. Unless it was accepted, its task is deleted too. Destructive.",
      inputSchema: z.object({ intakeItemId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/intake/item/${id(args.intakeItemId)}`, {
          method: "DELETE",
        }),
      ),
  );
}

const MAX_PAGE_MARKDOWN_BYTES = 1024 * 1024;

/** Markdown as the web editor writes it, at most 1 MiB. */
const pageMarkdownSchema = z
  .string()
  .refine(
    (value) =>
      new TextEncoder().encode(value).length <= MAX_PAGE_MARKDOWN_BYTES,
    "Keep the content under 1 MiB",
  );

type PageSummary = { archivedAt?: string | null; parentId?: string | null };

function registerPageTools<Result>({
  register,
  client,
  run,
  fail,
}: PlanningToolAdapters<Result>) {
  register(
    "list_pages",
    {
      description:
        "List a project's pages (title, place in the tree, lock and archive state) without their content. Use get_page to read a page's markdown. Archived pages are left out unless includeArchived; parentId narrows to one page's children, or null to root pages.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        includeArchived: z.boolean().optional(),
        parentId: nonEmptyString.nullable().optional(),
      }),
    },
    async (args) =>
      run(async () => {
        const pages = await client.json(
          `/api/page/project/${id(args.projectId)}`,
        );
        if (!Array.isArray(pages)) return pages;
        return (pages as PageSummary[]).filter(
          (page) =>
            (args.includeArchived || !page.archivedAt) &&
            (args.parentId === undefined ||
              (page.parentId ?? null) === args.parentId),
        );
      }),
  );

  register(
    "get_page",
    {
      description:
        "Get a page with its content as markdown (contentMarkdown). The content is the last saved version and can lag live edits by a few seconds.",
      inputSchema: z.object({ pageId: nonEmptyString }),
    },
    async (args) => run(() => client.json(`/api/page/${id(args.pageId)}`)),
  );

  register(
    "create_page",
    {
      description:
        "Create a page in a project, optionally under a parent page, with markdown content (at most 1 MiB). Private pages are visible only to you.",
      inputSchema: z.object({
        projectId: nonEmptyString,
        title: z.string().optional(),
        content: pageMarkdownSchema.optional(),
        parentId: optionalNonEmptyString,
        access: z.enum(["public", "private"]).optional(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/page/project/${id(args.projectId)}`,
          jsonBody(
            "POST",
            defined({
              title: args.title,
              content: args.content,
              parentId: args.parentId,
              access: args.access,
            }),
          ),
        ),
      ),
  );

  register(
    "update_page",
    {
      description:
        "Rename a page, change its full-width setting, and/or lock or unlock it. A locked page can't be edited, so unlocking happens first and locking last. Returns the final page.",
      inputSchema: z.object({
        pageId: nonEmptyString,
        title: z.string().optional(),
        isFullWidth: z.boolean().optional(),
        locked: z.boolean().optional(),
      }),
    },
    async (args) => {
      const patch = defined({
        title: args.title,
        isFullWidth: args.isFullWidth,
      });
      if (Object.keys(patch).length === 0 && args.locked === undefined) {
        return fail("Provide at least one field to change.");
      }
      return run(async () => {
        const path = `/api/page/${id(args.pageId)}`;
        let page: unknown;
        if (args.locked === false) {
          page = await client.json(`${path}/lock`, { method: "DELETE" });
        }
        if (Object.keys(patch).length > 0) {
          page = await client.json(path, jsonBody("PATCH", patch));
        }
        if (args.locked === true) {
          page = await client.json(`${path}/lock`, { method: "POST" });
        }
        return page;
      });
    },
  );

  register(
    "replace_page_content",
    {
      description:
        "Replace a page's whole document with markdown (at most 1 MiB). People editing the page receive the change live. Read the page first if you only want to change part of it.",
      inputSchema: z.object({
        pageId: nonEmptyString,
        content: pageMarkdownSchema,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/page/${id(args.pageId)}/content`,
          jsonBody("PUT", { markdown: args.content }),
        ),
      ),
  );

  register(
    "set_page_archived",
    {
      description:
        "Archive or restore a page. Archiving also archives its sub-pages.",
      inputSchema: z.object({
        pageId: nonEmptyString,
        archived: z.boolean(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/page/${id(args.pageId)}/${args.archived ? "archive" : "unarchive"}`,
          { method: "POST" },
        ),
      ),
  );

  register(
    "delete_page",
    {
      description: "Delete a page. It must be archived first. Destructive.",
      inputSchema: z.object({ pageId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/page/${id(args.pageId)}`, { method: "DELETE" }),
      ),
  );
}

function registerTemplateTools<Result>({
  register,
  client,
  run,
}: PlanningToolAdapters<Result>) {
  register(
    "list_task_templates",
    {
      description:
        "List a project's task templates: name, title pattern, default status, priority, labels, assignees, estimate and sub-task titles.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-template/project/${id(args.projectId)}`),
      ),
  );

  register(
    "create_task_from_template",
    {
      description:
        "Create a task from a task template. The title is merged into the template's title pattern; status (a column slug) overrides the template's column. The template's sub-tasks are created under the new task.",
      inputSchema: z.object({
        templateId: nonEmptyString,
        title: z.string().max(500).optional(),
        status: optionalNonEmptyString,
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/task-template/${id(args.templateId)}/apply`,
          jsonBody("POST", defined({ title: args.title, status: args.status })),
        ),
      ),
  );
}

function registerRecurrenceTools<Result>({
  register,
  client,
  run,
}: PlanningToolAdapters<Result>) {
  register(
    "get_task_recurrence",
    {
      description:
        "Get a task's repeat rule (frequency, interval, weekdays, day of month, trigger, end date or count, next date), or null when it does not repeat. Only the series' current instance holds the rule.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/task-recurrence/${id(args.taskId)}`)),
  );

  register(
    "set_task_recurrence",
    {
      description:
        "Make a task repeat, or replace its repeat rule. daily, weekly (weekdays 0 Sunday to 6 Saturday), monthly (monthDay 1-31) or yearly, every `interval` periods. trigger completion (default) creates the next instance when this one is completed; schedule creates it on its date in the workspace's time zone. Optionally end on endDate (YYYY-MM-DD) or after maxOccurrences instances, not both. The next instance copies title, description, labels, assignees, priority and estimate, with its dates moved.",
      inputSchema: z.object({
        taskId: nonEmptyString,
        frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
        interval: z.number().int().min(1).max(365).optional(),
        weekdays: z
          .array(z.number().int().min(0).max(6))
          .min(1)
          .max(7)
          .optional(),
        monthDay: z.number().int().min(1).max(31).optional(),
        trigger: z.enum(["completion", "schedule"]).optional(),
        endDate: nullableOptionalDateOnly,
        maxOccurrences: z.number().int().min(2).max(1000).nullable().optional(),
      }),
    },
    async ({ taskId, ...rule }) =>
      run(() =>
        client.json(
          `/api/task-recurrence/${id(taskId)}`,
          jsonBody("PUT", defined(rule)),
        ),
      ),
  );

  register(
    "remove_task_recurrence",
    {
      description:
        "Stop a task repeating: no further instances are created. Instances created already stay.",
      inputSchema: z.object({ taskId: nonEmptyString }),
    },
    async (args) =>
      run(() =>
        client.json(`/api/task-recurrence/${id(args.taskId)}`, {
          method: "DELETE",
        }),
      ),
  );
}

function registerAutomationTools<Result>({
  register,
  client,
  run,
}: PlanningToolAdapters<Result>) {
  register(
    "list_automation_rules",
    {
      description:
        "List a project's automation rules (When a task changes, If it meets conditions, Then act on it) with their trigger, conditions, actions, on/off state and run counters.",
      inputSchema: z.object({ projectId: nonEmptyString }),
    },
    async (args) =>
      run(() => client.json(`/api/automation-rule/${id(args.projectId)}`)),
  );

  register(
    "set_automation_rule_enabled",
    {
      description:
        "Turn one automation rule of a project on or off. Needs permission to manage the project (project:update).",
      inputSchema: z.object({
        projectId: nonEmptyString,
        ruleId: nonEmptyString,
        enabled: z.boolean(),
      }),
    },
    async (args) =>
      run(() =>
        client.json(
          `/api/automation-rule/${id(args.projectId)}/${id(args.ruleId)}`,
          jsonBody("PATCH", { enabled: args.enabled }),
        ),
      ),
  );
}

/** The tools this module registers, in order (for tests and docs). */
export const PLANNING_TOOL_NAMES = [
  "list_cycles",
  "get_cycle",
  "create_cycle",
  "update_cycle",
  "delete_cycle",
  "set_cycle_archived",
  "update_cycle_tasks",
  "set_task_cycle",
  "transfer_cycle_tasks",
  "list_modules",
  "get_module",
  "create_module",
  "update_module",
  "delete_module",
  "set_module_archived",
  "list_module_tasks",
  "update_module_tasks",
  "set_task_modules",
  "add_module_link",
  "delete_module_link",
  "list_pages",
  "get_page",
  "create_page",
  "update_page",
  "replace_page_content",
  "set_page_archived",
  "delete_page",
  "list_intake_items",
  "get_intake_item",
  "submit_intake_item",
  "update_intake_item",
  "triage_intake_item",
  "delete_intake_item",
  "list_task_templates",
  "create_task_from_template",
  "get_task_recurrence",
  "set_task_recurrence",
  "remove_task_recurrence",
  "list_automation_rules",
  "set_automation_rule_enabled",
] as const;

/**
 * Registers the cycle (9), module (11), page (7), intake (6), task
 * template (2), task repeat (3) and automation rule (2) tools.
 */
export function registerPlanningTools<Result>(
  adapters: PlanningToolAdapters<Result>,
): void {
  registerCycleTools(adapters);
  registerModuleTools(adapters);
  registerPageTools(adapters);
  registerIntakeTools(adapters);
  registerTemplateTools(adapters);
  registerRecurrenceTools(adapters);
  registerAutomationTools(adapters);
}
