import { and, eq, inArray } from "drizzle-orm";
import { setFakeResponder } from "../../../apps/api/src/ai/provider/fake";
import type { ChatRequest, ChatToolCall } from "../../../apps/api/src/ai/types";
import { drainAgentRuns } from "../../../apps/api/src/ai-agent/runner";
import db, { schema } from "../../../apps/api/src/database";
import type { Row, Snapshot } from "./agent-eval-score";
import type { draftScene } from "./drafts";

// The agent eval harness: scripted agent runs on the fake provider, judged
// by the database state they leave (agent-eval-score.ts). A scenario seeds
// a workspace, scripts the model's turns, runs the agent through the real
// API and runner, then diffs the domain rows of the workspace.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

/**
 * The domain state an agent can touch, keyed by stable ids. Explicit
 * columns only, so unrelated schema additions never change a snapshot.
 * Side-effect rows (activity entries other than comments, notifications,
 * the audit log, run steps) are not domain state and are left out.
 */
export async function snapshotWorkspace(
  workspaceId: string,
): Promise<Snapshot> {
  const projects = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));
  const projectIds = projects.map((p) => p.id);
  const snapshot: Snapshot = {
    task: {},
    cycle_task: {},
    module_task: {},
    custom_field_value: {},
    comment: {},
    task_relation: {},
    page: {},
  };
  if (projectIds.length === 0) return snapshot;

  const tasks = await db
    .select({
      id: schema.taskTable.id,
      projectId: schema.taskTable.projectId,
      title: schema.taskTable.title,
      description: schema.taskTable.description,
      status: schema.taskTable.status,
      priority: schema.taskTable.priority,
      dueDate: schema.taskTable.dueDate,
      deletedAt: schema.taskTable.deletedAt,
      archivedAt: schema.taskTable.archivedAt,
    })
    .from(schema.taskTable)
    .where(inArray(schema.taskTable.projectId, projectIds));
  const taskIds = tasks.map((t) => t.id);
  for (const t of tasks) {
    snapshot.task[t.id] = {
      projectId: t.projectId,
      title: t.title,
      description: t.description || null,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      trashed: t.deletedAt !== null,
      archived: t.archivedAt !== null,
    };
  }
  if (taskIds.length === 0) return snapshot;

  for (const row of await db
    .select({
      taskId: schema.cycleTaskTable.taskId,
      cycleId: schema.cycleTaskTable.cycleId,
    })
    .from(schema.cycleTaskTable)
    .where(inArray(schema.cycleTaskTable.taskId, taskIds))) {
    snapshot.cycle_task[row.taskId] = { cycleId: row.cycleId };
  }
  for (const row of await db
    .select({
      taskId: schema.moduleTaskTable.taskId,
      moduleId: schema.moduleTaskTable.moduleId,
    })
    .from(schema.moduleTaskTable)
    .where(inArray(schema.moduleTaskTable.taskId, taskIds))) {
    snapshot.module_task[`${row.moduleId}/${row.taskId}`] = {
      moduleId: row.moduleId,
      taskId: row.taskId,
    };
  }
  for (const row of await db
    .select({
      taskId: schema.customFieldValueTable.taskId,
      fieldId: schema.customFieldValueTable.fieldId,
      value: schema.customFieldValueTable.value,
    })
    .from(schema.customFieldValueTable)
    .where(inArray(schema.customFieldValueTable.taskId, taskIds))) {
    // A cleared value is stored as "": the same as no value.
    if (!row.value) continue;
    snapshot.custom_field_value[`${row.taskId}/${row.fieldId}`] = {
      taskId: row.taskId,
      fieldId: row.fieldId,
      value: row.value,
    };
  }
  for (const row of await db
    .select({
      id: schema.activityTable.id,
      taskId: schema.activityTable.taskId,
      content: schema.activityTable.content,
    })
    .from(schema.activityTable)
    .where(
      and(
        inArray(schema.activityTable.taskId, taskIds),
        eq(schema.activityTable.type, "comment"),
      ),
    )) {
    snapshot.comment[row.id] = { taskId: row.taskId, content: row.content };
  }
  for (const row of await db
    .select({
      id: schema.taskRelationTable.id,
      sourceTaskId: schema.taskRelationTable.sourceTaskId,
      targetTaskId: schema.taskRelationTable.targetTaskId,
      relationType: schema.taskRelationTable.relationType,
    })
    .from(schema.taskRelationTable)
    .where(inArray(schema.taskRelationTable.sourceTaskId, taskIds))) {
    snapshot.task_relation[row.id] = {
      sourceTaskId: row.sourceTaskId,
      targetTaskId: row.targetTaskId,
      relationType: row.relationType,
    };
  }
  for (const row of await db
    .select({
      id: schema.pageTable.id,
      title: schema.pageTable.title,
      archivedAt: schema.pageTable.archivedAt,
    })
    .from(schema.pageTable)
    .where(eq(schema.pageTable.workspaceId, workspaceId))) {
    snapshot.page[row.id] = {
      title: row.title,
      archived: row.archivedAt !== null,
    };
  }
  return snapshot;
}

/** One model turn: tool calls, or the closing text. */
export type Turn =
  | { tools: { name: string; input: Record<string, unknown> }[] }
  | { text: string };

/**
 * A scripted model: turn n of a run answers `turns[n]`, where n counts the
 * assistant messages already in the conversation. A turn may be a function
 * of the conversation so far (to use an id a tool returned).
 */
export function scriptModel(
  turns: (Turn | ((conversation: string) => Turn))[],
): void {
  setFakeResponder((request: ChatRequest) => {
    const index = request.messages.filter((m) => m.role === "assistant").length;
    const scripted = turns[index] ?? { text: "Done." };
    const turn =
      typeof scripted === "function"
        ? scripted(JSON.stringify(request.messages))
        : scripted;
    if ("text" in turn) return { text: turn.text };
    const toolCalls: ChatToolCall[] = turn.tools.map((call, i) => ({
      id: `eval_${index}_${i}`,
      name: call.name,
      input: call.input,
    }));
    return { text: "", toolCalls, stop: "tool_use" };
  });
}

/** The first id a tool result reported ("The new task's id is <id>."). */
export function createdTaskId(conversation: string): string {
  const id = /The new task's id is ([A-Za-z0-9_-]+)\./.exec(conversation)?.[1];
  if (!id) throw new Error("The conversation reports no created task");
  return id;
}

export type EvalStep = {
  id: string;
  kind: string;
  toolName: string | null;
  status: string;
  canUndo: boolean;
  approval: { id: string; status: string; canDecide: boolean } | null;
};

export type EvalRun = { id: string; status: string; steps: EvalStep[] };

/** Starts a run through the API, drains the queue and reads the run back. */
export async function runAgent(
  s: Scene,
  user: User,
  agentId: string,
  taskId: string,
  prompt: string,
): Promise<EvalRun> {
  const started = await s.ok<{ id: string }>(
    user,
    "POST",
    `/ai/agents/${agentId}/runs`,
    { workspaceId: s.workspaceId, taskId, prompt },
  );
  await drainAgentRuns();
  return s.ok<EvalRun>(
    user,
    "GET",
    `/ai/agents/runs/${started.id}?workspaceId=${s.workspaceId}`,
  );
}

/** Undoes every applied change of a run, newest first. */
export async function undoRun(s: Scene, user: User, run: EvalRun) {
  for (const step of [...run.steps].reverse()) {
    if (step.kind !== "tool" || !step.canUndo) continue;
    await s.ok(user, "POST", `/ai/agents/steps/${step.id}/undo`, {
      workspaceId: s.workspaceId,
    });
  }
}

export type { Row };
