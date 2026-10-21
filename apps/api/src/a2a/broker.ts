import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, lt, or } from "drizzle-orm";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  a2aTaskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import type { A2aApi, A2aApiResult } from "./api";
import {
  A2A_ERRORS,
  type A2aArtifact,
  A2aError,
  type A2aTask,
  agentMessage,
  decodePageToken,
  encodePageToken,
  intakeState,
  isTerminal,
  type ListTasksParams,
  runState,
  type SendMessageParams,
  type SkillInput,
  skillInput,
  splitTitle,
  type TaskState,
} from "./protocol";

// The A2A task broker: turns an external agent's message into Margaya work
// (a task, an intake request, an answer or an agent run) through the API's
// own routes, records the mapping in a2a_task, and reads each task's state
// back from what it maps onto.

export type A2aRow = typeof a2aTaskTable.$inferSelect;

export type BrokerContext = {
  api: A2aApi;
  userId: string;
  apiKeyId: string | null;
  workspace: { id: string; slug: string };
};

/** How long a blocking SendMessage waits for an agent run to finish. */
export const BLOCKING_WAIT_MS = 20_000;
const POLL_MS = 500;

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"];

type TenantRow = { id: string; slug: string };

/** Workspaces the person may hand work to over A2A (member, A2A on). */
export async function a2aTenantsOf(userId: string): Promise<TenantRow[]> {
  return db
    .select({ id: workspaceTable.id, slug: workspaceTable.slug })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceTable.allowA2a, true),
      ),
    )
    .orderBy(workspaceTable.slug);
}

/** Whether any workspace of this instance has A2A on (cached briefly). */
let anyEnabledCache: { value: boolean; at: number } | null = null;
export async function anyWorkspaceAllowsA2a(): Promise<boolean> {
  if (anyEnabledCache && Date.now() - anyEnabledCache.at < 30_000) {
    return anyEnabledCache.value;
  }
  const [row] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.allowA2a, true))
    .limit(1);
  anyEnabledCache = { value: Boolean(row), at: Date.now() };
  return anyEnabledCache.value;
}

export function resetA2aCaches(): void {
  anyEnabledCache = null;
}

export async function isAgentUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.kind === "agent";
}

/**
 * The workspace a request addresses: its tenant (a workspace slug), or the
 * caller's only A2A workspace. Unknown, foreign and A2A-off workspaces read
 * the same, so the answer never confirms one exists.
 */
export async function resolveTenant(
  userId: string,
  tenant: string | undefined,
): Promise<TenantRow> {
  const tenants = await a2aTenantsOf(userId);
  if (tenant) {
    const match = tenants.find(
      (row) => row.slug === tenant.toLowerCase() || row.id === tenant,
    );
    if (match) return match;
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      "Unknown tenant, or A2A is off for that workspace",
    );
  }
  const [only] = tenants;
  if (tenants.length === 1 && only) return only;
  throw new A2aError(
    A2A_ERRORS.invalidParams,
    tenants.length === 0
      ? "A2A is off for your workspaces"
      : "Name the workspace as the tenant (see GetExtendedAgentCard)",
  );
}

/** Maps a failed API call onto a JSON-RPC error without internals. */
function apiFailure(result: { status: number; message: string }): never {
  if (result.status === 401) {
    throw new A2aError(A2A_ERRORS.invalidRequest, "Unauthorized");
  }
  if (result.status === 404) {
    throw new A2aError(A2A_ERRORS.invalidParams, result.message || "Not found");
  }
  if (result.status === 403) {
    throw new A2aError(
      A2A_ERRORS.invalidRequest,
      `Forbidden: ${result.message || "missing permission"}`,
      { httpStatus: 403 },
    );
  }
  if (result.status === 429) {
    throw new A2aError(A2A_ERRORS.invalidRequest, "Rate limited", {
      httpStatus: 429,
    });
  }
  if (result.status >= 500) {
    throw new A2aError(A2A_ERRORS.internal, "Margaya could not do that");
  }
  throw new A2aError(A2A_ERRORS.invalidParams, result.message);
}

function must<T>(result: A2aApiResult<T>): T {
  if (!result.ok) apiFailure(result);
  return result.data;
}

function stringField(
  data: Record<string, unknown>,
  name: string,
  max = 200,
): string | undefined {
  const value = data[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new A2aError(A2A_ERRORS.invalidParams, `Invalid ${name}`);
  }
  return value.trim();
}

type ProjectJson = { id: string; slug: string; name: string };

/** A project the caller can see, by id or slug; restricted ones are not. */
async function resolveProject(
  ctx: BrokerContext,
  ref: string | undefined,
): Promise<ProjectJson> {
  if (!ref) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      'Name the project in a data part: {"project":"<slug or id>"}',
    );
  }
  const projects = must(
    await ctx.api<ProjectJson[]>(
      "GET",
      `/project?workspaceId=${encodeURIComponent(ctx.workspace.id)}`,
    ),
  );
  const wanted = ref.toLowerCase();
  const project = projects.find(
    (row) => row.id === ref || row.slug.toLowerCase() === wanted,
  );
  if (!project) throw new A2aError(A2A_ERRORS.invalidParams, "Unknown project");
  return project;
}

type ColumnJson = { slug: string; group: string; isFinal: boolean };

async function defaultStatus(ctx: BrokerContext, projectId: string) {
  const columns = must(
    await ctx.api<ColumnJson[]>(
      "GET",
      `/column/${encodeURIComponent(projectId)}`,
    ),
  );
  const open = columns.filter((column) => !column.isFinal);
  const column =
    open.find((c) => c.group === "unstarted") ??
    open.find((c) => c.group === "backlog") ??
    open[0] ??
    columns[0];
  if (!column) {
    throw new A2aError(A2A_ERRORS.invalidParams, "The project has no columns");
  }
  return column.slug;
}

function titled(input: SkillInput) {
  const split = splitTitle(input.text);
  const title = stringField(input.data, "title") ?? split.title;
  if (!title) {
    throw new A2aError(
      A2A_ERRORS.invalidParams,
      "Send a text part whose first line is the title",
    );
  }
  const description =
    stringField(input.data, "description", 50_000) ??
    (stringField(input.data, "title") ? input.text : split.description);
  const priority = stringField(input.data, "priority") ?? "no-priority";
  if (!PRIORITIES.includes(priority)) {
    throw new A2aError(A2A_ERRORS.invalidParams, "Invalid priority");
  }
  return { title, description, priority };
}

async function record(
  ctx: BrokerContext,
  values: Omit<
    typeof a2aTaskTable.$inferInsert,
    "workspaceId" | "userId" | "apiKeyId"
  >,
): Promise<A2aRow> {
  const [row] = await db
    .insert(a2aTaskTable)
    .values({
      ...values,
      workspaceId: ctx.workspace.id,
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId,
    })
    .returning();
  if (!row) throw new A2aError(A2A_ERRORS.internal, "Could not record task");
  // The work itself is audited by the routes that made it; this entry says
  // it came in over A2A, from whom and as what.
  await recordAudit({
    workspaceId: ctx.workspace.id,
    action: "a2a.task_received",
    target: { type: "a2a_task", id: row.id, label: row.skill },
    metadata: {
      skill: row.skill,
      refKind: row.refKind,
      refId: row.refId,
      projectId: row.projectId,
      contextId: row.contextId,
    },
    actor: { userId: ctx.userId, apiKeyId: ctx.apiKeyId },
  });
  return row;
}

type TaskJson = {
  id: string;
  projectId: string;
  number: number | null;
  title: string;
  status: string;
};

function taskArtifact(task: TaskJson, project?: ProjectJson): A2aArtifact {
  const key =
    project && task.number !== null
      ? `${project.slug.toUpperCase()}-${task.number}`
      : null;
  return {
    artifactId: `task-${task.id}`,
    name: "Task",
    parts: [
      { text: `${key ? `${key} ` : ""}${task.title}` },
      {
        data: {
          taskId: task.id,
          key,
          title: task.title,
          status: task.status,
          projectId: task.projectId,
        },
        mediaType: "application/json",
      },
    ],
  };
}

type Answer = {
  text: string;
  sources?: Array<{ ref: string; title: string; url: string }>;
};

type IntakeJson = {
  id: string;
  status: string;
  resolutionNote: string | null;
  task: { id: string; number: number | null; title: string };
  duplicateOf: { id: string; title?: string } | null;
};

type RunJson = {
  id: string;
  status: string;
  error: string | null;
  outputSummary: string | null;
  pendingApprovals?: number;
};

function taskOf(
  row: A2aRow,
  state: TaskState,
  extra: { message?: string; artifacts?: A2aArtifact[] } = {},
): A2aTask {
  return {
    id: row.id,
    contextId: row.contextId,
    status: {
      state,
      ...(extra.message
        ? {
            message: agentMessage(extra.message, {
              taskId: row.id,
              contextId: row.contextId,
            }),
          }
        : {}),
      timestamp: row.updatedAt.toISOString(),
    },
    ...(extra.artifacts && extra.artifacts.length > 0
      ? { artifacts: extra.artifacts }
      : {}),
    metadata: { skill: row.skill },
  };
}

/** The live A2A view of a recorded task (TaskNotFound once out of reach). */
export async function describeTask(
  ctx: BrokerContext,
  row: A2aRow,
  options: { includeArtifacts?: boolean } = {},
): Promise<A2aTask> {
  const withArtifacts = options.includeArtifacts !== false;
  const gone = () => new A2aError(A2A_ERRORS.taskNotFound, "Task not found");
  if (row.finalState) {
    return taskOf(row, row.finalState as TaskState, {
      message:
        row.refKind === "answer"
          ? "Answered. Margaya doesn't store answers; the answer came with the original response."
          : undefined,
    });
  }
  switch (row.refKind) {
    case "task": {
      const result = await ctx.api<TaskJson>(
        "GET",
        `/task/${encodeURIComponent(row.refId ?? "")}`,
      );
      if (!result.ok) {
        if (result.status === 404 || result.status === 403) throw gone();
        apiFailure(result);
      }
      return taskOf(row, "TASK_STATE_COMPLETED", {
        artifacts: withArtifacts ? [taskArtifact(result.data)] : [],
      });
    }
    case "intake": {
      const result = await ctx.api<IntakeJson>(
        "GET",
        `/intake/item/${encodeURIComponent(row.refId ?? "")}`,
      );
      if (!result.ok) {
        if (result.status === 404 || result.status === 403) throw gone();
        apiFailure(result);
      }
      const item = result.data;
      const state = intakeState(item.status);
      const message =
        item.status === "declined"
          ? `Declined${item.resolutionNote ? `: ${item.resolutionNote}` : ""}`
          : item.status === "duplicate"
            ? `Already tracked${item.duplicateOf?.title ? ` as "${item.duplicateOf.title}"` : ""}${item.resolutionNote ? `: ${item.resolutionNote}` : ""}`
            : item.status === "accepted"
              ? "Accepted into the project"
              : "Waiting for triage";
      const accepted = item.status === "accepted";
      return taskOf(row, state, {
        message,
        artifacts:
          withArtifacts && accepted
            ? [
                taskArtifact({
                  id: item.task.id,
                  projectId: row.projectId ?? "",
                  number: item.task.number,
                  title: item.task.title,
                  status: "accepted",
                }),
              ]
            : [],
      });
    }
    case "ai_run": {
      const result = await ctx.api<RunJson>(
        "GET",
        `/ai/agents/runs/${encodeURIComponent(row.refId ?? "")}?workspaceId=${encodeURIComponent(row.workspaceId)}`,
      );
      if (!result.ok) {
        if (result.status === 404 || result.status === 403) throw gone();
        apiFailure(result);
      }
      const run = result.data;
      const state = runState(run.status);
      const message =
        run.status === "awaiting_approval"
          ? "Waiting for a person's approval in Margaya"
          : run.status === "failed"
            ? `Failed${run.error ? ` (${run.error})` : ""}`
            : run.status === "queued"
              ? "Queued"
              : run.status === "running"
                ? "Working"
                : undefined;
      return taskOf(row, state, {
        message,
        artifacts:
          withArtifacts && run.status === "succeeded" && run.outputSummary
            ? [
                {
                  artifactId: `run-${run.id}`,
                  name: "Agent summary",
                  parts: [{ text: run.outputSummary }],
                },
              ]
            : [],
      });
    }
    default:
      throw gone();
  }
}

export async function readA2aRow(
  ctx: BrokerContext,
  id: string,
): Promise<A2aRow> {
  const [row] = await db
    .select()
    .from(a2aTaskTable)
    .where(
      and(
        eq(a2aTaskTable.id, id),
        eq(a2aTaskTable.workspaceId, ctx.workspace.id),
        eq(a2aTaskTable.userId, ctx.userId),
      ),
    )
    .limit(1);
  if (!row) throw new A2aError(A2A_ERRORS.taskNotFound, "Task not found");
  return row;
}

export async function getTask(ctx: BrokerContext, id: string) {
  return describeTask(ctx, await readA2aRow(ctx, id));
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Polls a task until it is terminal, `until` passes, or `signal` aborts. */
export async function waitForTask(
  ctx: BrokerContext,
  row: A2aRow,
  until: number,
  onChange?: (task: A2aTask) => Promise<void>,
  signal?: AbortSignal,
): Promise<A2aTask> {
  let task = await describeTask(ctx, row);
  while (!isTerminal(task.status.state) && Date.now() < until) {
    if (signal?.aborted) break;
    await sleep(POLL_MS);
    const next = await describeTask(ctx, row);
    if (next.status.state !== task.status.state && onChange) {
      await onChange(next);
    }
    task = next;
  }
  return task;
}

/** SendMessage: does what the message asks and returns the A2A task. */
export async function sendMessage(
  ctx: BrokerContext,
  params: SendMessageParams,
): Promise<{ task: A2aTask; row: A2aRow }> {
  if (params.configuration?.taskPushNotificationConfig !== undefined) {
    throw new A2aError(
      A2A_ERRORS.pushNotificationNotSupported,
      "Push notifications are not supported; poll GetTask or stream",
    );
  }
  if (params.message.taskId) {
    throw new A2aError(
      A2A_ERRORS.unsupportedOperation,
      "Margaya tasks take no follow-up messages; send a new message with the same contextId",
    );
  }
  const input = skillInput(params.message, params.metadata);
  const contextId = params.message.contextId ?? randomUUID();

  switch (input.skill) {
    case "create_task": {
      const project = await resolveProject(
        ctx,
        stringField(input.data, "project", 128),
      );
      const fields = titled(input);
      const dueDate = stringField(input.data, "dueDate", 40);
      if (dueDate && Number.isNaN(Date.parse(dueDate))) {
        throw new A2aError(A2A_ERRORS.invalidParams, "Invalid dueDate");
      }
      const created = must(
        await ctx.api<TaskJson>(
          "POST",
          `/task/${encodeURIComponent(project.id)}`,
          {
            ...fields,
            status:
              stringField(input.data, "status", 128) ??
              (await defaultStatus(ctx, project.id)),
            ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
          },
        ),
      );
      const row = await record(ctx, {
        contextId,
        skill: "create_task",
        refKind: "task",
        refId: created.id,
        projectId: project.id,
      });
      return {
        row,
        task: taskOf(row, "TASK_STATE_COMPLETED", {
          message: "Created",
          artifacts: [taskArtifact(created, project)],
        }),
      };
    }
    case "triage_request": {
      const project = await resolveProject(
        ctx,
        stringField(input.data, "project", 128),
      );
      const fields = titled(input);
      const item = must(
        await ctx.api<IntakeJson>(
          "POST",
          `/intake/project/${encodeURIComponent(project.id)}`,
          fields,
        ),
      );
      const row = await record(ctx, {
        contextId,
        skill: "triage_request",
        refKind: "intake",
        refId: item.id,
        projectId: project.id,
      });
      return {
        row,
        task: taskOf(row, intakeState(item.status), {
          message: "Waiting for triage",
        }),
      };
    }
    case "ask_workspace": {
      if (!input.text) {
        throw new A2aError(
          A2A_ERRORS.invalidParams,
          "Send the question as text",
        );
      }
      const projectRef = stringField(input.data, "project", 128);
      const project = projectRef
        ? await resolveProject(ctx, projectRef)
        : undefined;
      const locale = stringField(input.data, "locale", 16);
      const answer = must(
        await ctx.api<Answer>("POST", "/ai/ask?stream=false", {
          workspaceId: ctx.workspace.id,
          question: input.text.slice(0, 2_000),
          ...(project ? { projectId: project.id } : {}),
          ...(locale ? { locale } : {}),
        }),
      );
      const row = await record(ctx, {
        contextId,
        skill: "ask_workspace",
        refKind: "answer",
        projectId: project?.id ?? null,
        finalState: "TASK_STATE_COMPLETED",
      });
      return {
        row,
        task: taskOf(row, "TASK_STATE_COMPLETED", {
          artifacts: [
            {
              artifactId: `answer-${row.id}`,
              name: "Answer",
              parts: [
                { text: answer.text },
                {
                  data: {
                    sources: (answer.sources ?? []).map((source) => ({
                      ref: source.ref,
                      title: source.title,
                      url: source.url,
                    })),
                  },
                  mediaType: "application/json",
                },
              ],
            },
          ],
        }),
      };
    }
    case "run_agent": {
      const agentRef = stringField(input.data, "agent", 128);
      const taskId = stringField(input.data, "task", 128);
      if (!agentRef || !taskId) {
        throw new A2aError(
          A2A_ERRORS.invalidParams,
          'Name the agent and the task: {"agent":"<name or id>","task":"<task id>"}',
        );
      }
      if (!input.text) {
        throw new A2aError(
          A2A_ERRORS.invalidParams,
          "Send the instructions as text",
        );
      }
      const agents = must(
        await ctx.api<Array<{ id: string; name: string; enabled: boolean }>>(
          "GET",
          `/ai/agents?workspaceId=${encodeURIComponent(ctx.workspace.id)}`,
        ),
      );
      const wanted = agentRef.toLowerCase();
      const agent = agents.find(
        (row) => row.id === agentRef || row.name.toLowerCase() === wanted,
      );
      if (!agent) throw new A2aError(A2A_ERRORS.invalidParams, "Unknown agent");
      const started = must(
        await ctx.api<{ id: string; status: string }>(
          "POST",
          `/ai/agents/${encodeURIComponent(agent.id)}/runs`,
          {
            workspaceId: ctx.workspace.id,
            taskId,
            prompt: input.text.slice(0, 4_000),
          },
        ),
      );
      const row = await record(ctx, {
        contextId,
        skill: "run_agent",
        refKind: "ai_run",
        refId: started.id,
      });
      const task = params.configuration?.returnImmediately
        ? taskOf(row, runState(started.status), { message: "Queued" })
        : await waitForTask(ctx, row, Date.now() + BLOCKING_WAIT_MS);
      return { row, task };
    }
  }
}

/** CancelTask: only agent runs can be cancelled. */
export async function cancelTask(ctx: BrokerContext, id: string) {
  const row = await readA2aRow(ctx, id);
  if (row.refKind !== "ai_run" || !row.refId) {
    throw new A2aError(
      A2A_ERRORS.taskNotCancelable,
      row.refKind === "intake"
        ? "Requests are triaged by people; this one can't be cancelled"
        : "This task is already complete",
    );
  }
  const result = await ctx.api(
    "POST",
    `/ai/agents/runs/${encodeURIComponent(row.refId)}/cancel`,
    { workspaceId: row.workspaceId },
  );
  if (!result.ok) {
    if (result.status === 409) {
      throw new A2aError(A2A_ERRORS.taskNotCancelable, "The run has ended");
    }
    if (result.status === 404) {
      throw new A2aError(A2A_ERRORS.taskNotFound, "Task not found");
    }
    apiFailure(result);
  }
  await db
    .update(a2aTaskTable)
    .set({ updatedAt: new Date() })
    .where(eq(a2aTaskTable.id, row.id));
  return describeTask(ctx, { ...row, updatedAt: new Date() });
}

/** ListTasks: the caller's own A2A tasks in the tenant, newest first. */
export async function listTasks(ctx: BrokerContext, params: ListTasksParams) {
  const pageSize = params.pageSize ?? 50;
  const cursor = params.pageToken ? decodePageToken(params.pageToken) : null;
  if (params.pageToken && !cursor) {
    throw new A2aError(A2A_ERRORS.invalidParams, "Invalid pageToken");
  }
  const base = and(
    eq(a2aTaskTable.workspaceId, ctx.workspace.id),
    eq(a2aTaskTable.userId, ctx.userId),
    params.contextId ? eq(a2aTaskTable.contextId, params.contextId) : undefined,
    params.statusTimestampAfter
      ? gte(a2aTaskTable.updatedAt, new Date(params.statusTimestampAfter))
      : undefined,
  );
  const [total] = await db
    .select({ value: count() })
    .from(a2aTaskTable)
    .where(base);
  const rows = await db
    .select()
    .from(a2aTaskTable)
    .where(
      and(
        base,
        cursor
          ? or(
              lt(a2aTaskTable.createdAt, cursor.createdAt),
              and(
                eq(a2aTaskTable.createdAt, cursor.createdAt),
                lt(a2aTaskTable.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(a2aTaskTable.createdAt), desc(a2aTaskTable.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const tasks: A2aTask[] = [];
  for (const row of page) {
    try {
      const task = await describeTask(ctx, row, {
        includeArtifacts: params.includeArtifacts === true,
      });
      // The status filter applies to this page's live states.
      if (!params.status || task.status.state === params.status) {
        tasks.push(task);
      }
    } catch (error) {
      // Work the caller can no longer see is left out.
      if (!(error instanceof A2aError)) throw error;
    }
  }
  const last = page.at(-1);
  return {
    tasks,
    nextPageToken:
      rows.length > pageSize && last
        ? encodePageToken(last.createdAt, last.id)
        : "",
    pageSize,
    totalSize: total?.value ?? 0,
  };
}
