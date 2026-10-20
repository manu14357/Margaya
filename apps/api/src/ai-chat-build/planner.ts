import { eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  type AiContextItem,
  type AiScope,
  assertProjectInScope,
  contextDataTier,
  loadPageContext,
  loadProjectsContext,
  loadTaskContext,
  renderContext,
  resolveAiScopeFor,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { getAiInstanceConfig } from "../ai/instance-config";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { dataTierOf } from "../ai/router";
import { formatMemoryNotes, memoryNotesFor } from "../ai-memory-notes/load";
import db from "../database";
import { userTable } from "../database/schema";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { loadPlanFacts, loadTasks, type PlanFacts, renderFacts } from "./facts";
import {
  ACTION_OPS,
  type ChatBuildAction,
  type CONTEXT_KINDS,
  MAX_ACTIONS,
} from "./schema";
import { mentionedTaskRefs, validateActions } from "./validate";

// The Build planner: a request in chat becomes a list of proposed actions
// (or one clarifying question). The model sees the caller's AI scope as
// facts with ids (projects with statuses, cycles, modules, members, agents,
// labels) plus the items they @-mentioned; its answer is untrusted and goes
// through validateActions before anyone sees it. Nothing changes here.

const PLANNER_INSTRUCTIONS = `Your job: turn the user's request into a short list of concrete ACTIONS in Margaya, as JSON matching the given schema. The user reviews every action and confirms before anything changes.

Answer with:
- status "proposal" with the actions, when the request is clear.
- status "question" with question.text and 2 to 5 short question.options, only when something essential is ambiguous (for example two members share a name, or it is unclear which project or task is meant). Then actions is empty.
- When asked to write, add or improve text (a description, comment, page or title) and the exact words aren't given, WRITE it yourself from the mentioned items (the task's title, description, comments, related pages) and the facts. Don't ask for the text; the user reviews and can edit it before confirming.
- status "nothing" when no change fits (for example a plain question); explain in summary.
- summary: one or two sentences on what the actions do.
- When not asking, question is {"text": "", "options": []}.

Each action: op, a human-readable title (e.g. "Create project NX-7 Sensor Fusion", "Assign WEB-12 to Elena"), a one-line detail (or ""), a tempId ("" unless a later action points at what this one creates: use p1, t1, c1, m1, …), and params: ONE JSON object encoded as a string. Params by op (ids come from the facts; "?" marks optional fields; never invent ids):
- create_project: {"name","key"?: 2-8 letters/digits,"description"?,"leadUserId"?}
- create_task: {"projectId" | "projectRef","title","description"?,"priority"?: no-priority|low|medium|high|urgent,"status"?: a status slug of that project,"assigneeIds"?: member ids,"dueDate"?: YYYY-MM-DD,"labels"?: label names,"parentTaskId" | "parentRef"?}
- update_task: {"taskId" | "taskRef","fields": {"title"?,"description"?,"priority"?,"dueDate"?: YYYY-MM-DD or null}}
- set_status: {"taskId" | "taskRef","status": a status slug}
- assign: {"taskId" | "taskRef","userIds": member ids to add}
- add_comment: {"taskId" | "taskRef","content": Markdown}
- create_cycle: {"projectId" | "projectRef","name","startDate"?,"endDate"?} (both dates or neither)
- add_to_cycle: {"cycleId" | "cycleRef","taskIds"?: [...],"taskRefs"?: [...]}
- create_module: {"projectId" | "projectRef","name","description"?}
- add_to_module: {"moduleId" | "moduleRef","taskIds"?: [...],"taskRefs"?: [...]}
- create_page: {"projectId" | "projectRef","title","content": Markdown}
- link_tasks: {"taskId" | "taskRef","targetTaskId" | "targetRef","relationType": blocks|blocked_by|related|duplicate|subtask}
- create_label: {"name","color": gray|dark-gray|purple|teal|green|yellow|orange|pink|red}
- delete_task: {"taskId"} (only when the user explicitly asks to delete)
- run_agent: {"agentId","taskId" | "taskRef","prompt"} (when the user hands work to an agent, e.g. "@Atlas triage WEB-12")

Rules:
- *Ref fields hold the tempId of an EARLIER action of this plan; *Id fields hold ids from the facts. Tasks may be named by key (WEB-12).
- Use member ids from the facts; if a person is not listed, ask instead of guessing.
- Without a named project, new things go into the current project when there is one.
- Order actions so that what is created comes before what uses it. At most ${MAX_ACTIONS} actions; prefer fewer, larger steps the user can review.
- Only do what was asked. Earlier turns are context (what "it" or "that task" means); propose only what the latest request asks for, not again what earlier turns already did. Never touch roles, invitations, keys, webhooks or settings.
- Write titles, names, descriptions and comments in the answer language.`;

const MODEL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "question", "actions"],
  properties: {
    status: { type: "string", enum: ["proposal", "question", "nothing"] },
    summary: { type: "string" },
    question: {
      type: "object",
      additionalProperties: false,
      required: ["text", "options"],
      properties: {
        text: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "title", "detail", "tempId", "params"],
        properties: {
          op: { type: "string", enum: [...ACTION_OPS] },
          title: { type: "string" },
          detail: { type: "string" },
          tempId: { type: "string" },
          params: {
            type: "string",
            description: "The op's params as one JSON object.",
          },
        },
      },
    },
  },
};

export type PlanInput = {
  projectId?: string;
  prompt: string;
  history?: { question: string; answer: string }[];
  context?: { kind: (typeof CONTEXT_KINDS)[number]; id: string }[];
};

export type PlanOutcome = {
  status: "proposal" | "question" | "nothing";
  summary: string;
  actions: ChatBuildAction[];
  question?: { text: string; options: string[] };
  truncated: boolean;
  model: string;
  reasoningMs: number | null;
};

/**
 * What the plan was made from, shown to the person while it is made: the
 * size of the facts, the items read in full (titles and links only, all
 * within the caller's scope) and how much memory it had.
 */
export type PlanContext = {
  facts: { projects: number; tasks: number; members: number; cycles: number };
  items: { kind: AiContextItem["kind"]; title: string; url: string }[];
  memoryNotes: number;
  earlierTurns: number;
};

export type PlanEvents = {
  onContext?: (context: PlanContext) => void | Promise<void>;
  /** Reasoning text ("" when the instance hides it: only the timing shows). */
  onReasoning?: (text: string) => void | Promise<void>;
  signal?: AbortSignal;
};

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Requested context items: fresh, scope-checked, unreadable ones skipped. */
async function loadRequestedContext(
  scope: AiScope,
  facts: PlanFacts,
  items: PlanInput["context"],
): Promise<{ items: AiContextItem[]; lines: string[] }> {
  const out: AiContextItem[] = [];
  const lines: string[] = [];
  for (const item of items ?? []) {
    try {
      switch (item.kind) {
        case "task":
          out.push(
            ...(await loadTaskContext(scope, item.id, {
              comments: 3,
              maxChars: 4000,
            })),
          );
          break;
        case "page":
          out.push(await loadPageContext(scope, item.id, { maxChars: 6000 }));
          break;
        case "project":
          out.push(...(await loadProjectsContext(scope, [item.id])));
          break;
        case "cycle": {
          const cycle = facts.cycles.find((c) => c.id === item.id);
          if (cycle)
            lines.push(`Mentioned cycle: ${cycle.name} [id ${cycle.id}]`);
          break;
        }
        case "module": {
          const module = facts.modules.find((m) => m.id === item.id);
          if (module) {
            lines.push(`Mentioned module: ${module.name} [id ${module.id}]`);
          }
          break;
        }
        case "member": {
          const member = facts.members.find((m) => m.id === item.id);
          if (member) {
            lines.push(`Mentioned member: ${member.name} [id ${member.id}]`);
          }
          break;
        }
        case "agent": {
          const agent = facts.agents.find(
            (a) => a.id === item.id || a.userId === item.id,
          );
          if (agent) {
            lines.push(`Mentioned agent: ${agent.name} [agentId ${agent.id}]`);
          }
          break;
        }
      }
    } catch {
      // Not found or not readable for the caller: left out, never hinted at.
    }
  }
  return { items: out, lines };
}

const TASK_KEY = /\b[\p{L}\p{N}_]+-\d+\b/gu;

/** Task keys in the request, then in the last two earlier turns. */
export function typedTaskKeys(
  input: Pick<PlanInput, "prompt" | "history">,
): string[] {
  const recent = (input.history ?? [])
    .slice(-2)
    .flatMap((turn) => [turn.question, turn.answer]);
  return [
    ...new Set(
      [input.prompt, ...recent].flatMap((text) => text.match(TASK_KEY) ?? []),
    ),
  ];
}

async function userLocale(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user?.locale ?? null;
}

/** The caller's scope, facts and permission checker for a plan or apply. */
export async function planScope(
  c: Context,
  input: { projectId?: string | null; taskRefs?: readonly string[] },
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const can = await workspacePermissionChecker(c);
  const scope = await resolveAiScopeFor({ workspaceId, userId, can });
  if (input.projectId) assertProjectInScope(scope, input.projectId);
  const facts = await loadPlanFacts(scope, {
    focusProjectId: input.projectId,
    taskRefs: input.taskRefs,
  });
  return { workspaceId, userId, can, scope, facts };
}

export async function planBuild(
  c: Context,
  input: PlanInput,
  events: PlanEvents = {},
): Promise<PlanOutcome> {
  const contextTaskIds = (input.context ?? [])
    .filter((item) => item.kind === "task")
    .map((item) => item.id);
  const { workspaceId, userId, can, scope, facts } = await planScope(c, {
    projectId: input.projectId,
    taskRefs: [
      ...contextTaskIds,
      // Keys typed in the prompt ("move WEB-12 to Done") or the turns just
      // before it (an answer to a question keeps its subject).
      ...typedTaskKeys(input).slice(0, 30),
    ],
  });

  const requested = await loadRequestedContext(scope, facts, input.context);
  // Tasks named by key in the request ("add a description to WEB-18") are
  // read in full like @-mentioned ones, so the plan can write from them.
  // Keys from earlier turns count only when the request names none ("also
  // make it high priority"), so an earlier answer's list doesn't crowd out
  // the task being asked about.
  const ownKeys = typedTaskKeys({ prompt: input.prompt });
  const readKeys = ownKeys.length > 0 ? ownKeys : typedTaskKeys(input);
  const loaded = new Set(
    requested.items.filter((item) => item.kind === "task").map((i) => i.id),
  );
  const toRead = readKeys
    .map((key) =>
      facts.tasks.find((t) => t.key.toUpperCase() === key.toUpperCase()),
    )
    .filter((task): task is NonNullable<typeof task> =>
      Boolean(task && !loaded.has(task.id)),
    )
    .slice(0, 5);
  for (const task of toRead) {
    try {
      requested.items.push(
        ...(await loadTaskContext(scope, task.id, {
          comments: 5,
          maxChars: 4000,
        })),
      );
    } catch {
      // Not readable for the caller: the plan works from its key only.
    }
  }
  const memory = await memoryNotesFor({
    workspaceId,
    projectId: input.projectId ?? null,
    userId,
  });
  const notes = formatMemoryNotes(memory);
  await events.onContext?.({
    facts: {
      projects: facts.projects.length,
      tasks: facts.tasks.length,
      members: facts.members.length,
      cycles: facts.cycles.length,
    },
    items: requested.items.map(({ kind, title, url }) => ({
      kind,
      title,
      url,
    })),
    memoryNotes: memory.length,
    earlierTurns: input.history?.length ?? 0,
  });
  const showReasoning = getAiInstanceConfig().showReasoning;
  const focus = input.projectId
    ? facts.projects.find((project) => project.id === input.projectId)
    : null;
  const factsBlock = wrapUntrusted({
    source: "workspace:facts",
    text: renderFacts(facts),
    maxChars: 40_000,
  });
  const history = (input.history ?? []).flatMap((turn) => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer || "(no answer)" },
  ]);

  const { value, result } = await aiCompleteJson<unknown>(
    {
      workspaceId,
      userId,
      feature: "build_chat",
      tier: "balanced",
      context: requested.items,
      dataTier: dataTierOf(
        [
          contextDataTier(requested.items),
          facts.projects.some((project) => project.restricted)
            ? "restricted"
            : "private",
        ],
        "private",
      ),
      projectIds: facts.projects.map((project) => project.id),
      system: buildSystemPrompt({
        instructions: PLANNER_INSTRUCTIONS,
        locale: await userLocale(userId),
        extra: [
          focus
            ? `The current project is "${focus.name}" (key ${focus.key}, id ${focus.id}).`
            : "There is no current project.",
          ...(notes ? [notes] : []),
        ],
      }),
      messages: [
        ...history,
        {
          role: "user",
          content: [
            `Workspace facts:\n${factsBlock}`,
            requested.lines.length > 0 ? requested.lines.join("\n") : null,
            requested.items.length > 0
              ? `Mentioned items:\n${renderContext(requested.items, { maxChars: 30_000 })}`
              : null,
            `Request:\n${input.prompt}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      jsonSchema: MODEL_SCHEMA,
      maxTokens: 12_000,
      ...(events.onReasoning ? { reasoning: showReasoning } : {}),
      ...(events.signal ? { signal: events.signal } : {}),
    },
    {
      onReasoning: events.onReasoning
        ? (delta) => events.onReasoning?.(showReasoning ? delta : "")
        : undefined,
    },
  );

  const root = asObject(value) ?? {};
  const rawActions = Array.isArray(root.actions) ? root.actions : [];
  // Tasks the model named that the first load didn't cover.
  const extraRefs = mentionedTaskRefs(rawActions).filter(
    (ref) =>
      !facts.tasks.some(
        (task) =>
          task.id === ref || task.key.toLowerCase() === ref.toLowerCase(),
      ),
  );
  if (extraRefs.length > 0) {
    facts.tasks.push(...(await loadTasks(scope, extraRefs)));
  }
  const { actions, truncated } = validateActions(rawActions, {
    facts,
    can,
    defaultProjectId: input.projectId ?? null,
    source: "model",
  });

  const question = asObject(root.question);
  const questionText = text(question?.text, 1000);
  const options = (Array.isArray(question?.options) ? question.options : [])
    .map((option) => text(option, 200))
    .filter(Boolean)
    .slice(0, 6);
  const summary = text(root.summary, 2000);
  const model = result.meta.model;
  const reasoningMs = result.reasoningMs ?? null;

  if (root.status === "question" && questionText) {
    return {
      status: "question",
      summary,
      actions: [],
      question: { text: questionText, options },
      truncated: false,
      model,
      reasoningMs,
    };
  }
  if (actions.length === 0) {
    return {
      status: "nothing",
      summary,
      actions: [],
      truncated: false,
      model,
      reasoningMs,
    };
  }
  return {
    status: "proposal",
    summary,
    actions,
    truncated,
    model,
    reasoningMs,
  };
}
