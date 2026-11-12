import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import { drainAgentRuns } from "../../apps/api/src/ai-agent/runner";
import db, { schema } from "../../apps/api/src/database";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  createdTaskId,
  type EvalRun,
  runAgent,
  scriptModel,
  snapshotWorkspace,
  type Turn,
  undoRun,
} from "./helpers/agent-eval";
import {
  diffSnapshots,
  type Expectation,
  reliability,
  scoreDiff,
} from "./helpers/agent-eval-score";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Agent reliability evals (state diff, pass^k). Each scenario seeds a fresh
// workspace, scripts the model on the fake provider, runs the agent through
// the real API, runner, permissions, approvals and undo, and scores the
// rows it changed against what the scenario expects: nothing missing and
// nothing extra. Every scenario runs K times (MARGAYA_AGENT_EVAL_K, default
// 3) and must pass all of them.

const K = Math.max(1, Number(process.env.MARGAYA_AGENT_EVAL_K ?? 3) || 3);

const AI_ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_USER_CONCURRENCY",
] as const;

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  setAiProviderFactory(null);
});

beforeEach(() => {
  resetRateLimitMemory();
  resetAiGatewayState();
});

async function evalScene(agent: Record<string, unknown> = {}) {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  process.env.MARGAYA_AI_USER_CONCURRENCY = "0";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  const bot = await s.ok<{ id: string }>(s.owner, "POST", "/ai/agents", {
    workspaceId: s.workspaceId,
    name: "Planner",
    instructions: "Keep the plan tidy.",
    ...agent,
  });
  const task = await s.ok<{ id: string }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Ship invoices export",
      description: "Customers need PDF invoices.",
      priority: "low",
      status: "to-do",
      assigneeIds: [],
    },
  );
  const other = await s.ok<{ id: string }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Email invoices",
      description: "Send each invoice by email.",
      priority: "low",
      status: "to-do",
      assigneeIds: [],
    },
  );
  const sprintA = await s.insertCycle({ name: "Sprint A" });
  const sprintB = await s.insertCycle({ name: "Sprint B" });
  const billing = await s.insertModule({ name: "Billing" });
  const team = await s.insertField({ name: "Team" });
  return { s, bot, task, other, sprintA, sprintB, billing, team };
}

type EvalScene = Awaited<ReturnType<typeof evalScene>>;

type Scenario = {
  name: string;
  agent?: Record<string, unknown>;
  /** Extra seeding after the scene, before the "before" snapshot. */
  seed?: (scene: EvalScene) => Promise<void>;
  turns: (scene: EvalScene) => (Turn | ((conversation: string) => Turn))[];
  expected: (scene: EvalScene) => Expectation[];
  /** After the scored run: undoing every change must restore this diff. */
  afterUndo?: (scene: EvalScene) => Expectation[];
  /** Extra checks on the run itself. */
  check?: (run: EvalRun, scene: EvalScene) => void;
};

const SCENARIOS: Scenario[] = [
  {
    name: "files a follow-up task and plans it into a cycle",
    turns: ({ s, sprintB }) => [
      {
        tools: [
          {
            name: "create_task",
            input: {
              project: s.web.project.slug,
              title: "Write release notes",
              priority: "medium",
            },
          },
        ],
      },
      (conversation) => ({
        tools: [
          {
            name: "set_task_cycle",
            input: { task: createdTaskId(conversation), cycle: sprintB.name },
          },
        ],
      }),
      { text: "Filed and planned." },
    ],
    expected: ({ s, sprintB }) => [
      {
        table: "task",
        kind: "added",
        where: {
          projectId: s.web.project.id,
          title: "Write release notes",
          status: "to-do",
          priority: "medium",
          trashed: false,
          archived: false,
        },
      },
      { table: "cycle_task", kind: "added", where: { cycleId: sprintB.id } },
    ],
    // Undo archives the created task (restorable; members can't delete)
    // and takes it out of the cycle.
    afterUndo: ({ s }) => [
      {
        table: "task",
        kind: "added",
        where: {
          projectId: s.web.project.id,
          title: "Write release notes",
          trashed: false,
          archived: true,
        },
      },
    ],
  },
  {
    name: "triages a task: module, custom field and comment",
    turns: ({ task }) => [
      {
        tools: [
          {
            name: "set_task_modules",
            input: { task: task.id, add: ["billing"] },
          },
          {
            name: "set_custom_field",
            input: { task: task.id, field: "team", value: "growth" },
          },
          { name: "add_comment", input: { task: task.id, body: "Triaged." } },
        ],
      },
      { text: "Triaged." },
    ],
    expected: ({ task, billing, team }) => [
      {
        table: "module_task",
        kind: "added",
        where: { moduleId: billing.id, taskId: task.id },
      },
      {
        table: "custom_field_value",
        kind: "added",
        where: { taskId: task.id, fieldId: team.id, value: "Growth" },
      },
      {
        table: "comment",
        kind: "added",
        where: { taskId: task.id, content: "Triaged." },
      },
    ],
    afterUndo: () => [],
  },
  {
    name: "moves a task to the next cycle without touching anything else",
    seed: async ({ s, task, sprintA }) => {
      await s.ok(s.mia, "PUT", `/cycle/task/${task.id}`, {
        cycleId: sprintA.id,
      });
    },
    turns: ({ task }) => [
      {
        tools: [
          {
            name: "set_task_cycle",
            input: { task: task.id, cycle: "Sprint B" },
          },
        ],
      },
      { text: "Moved." },
    ],
    expected: ({ task, sprintA, sprintB }) => [
      {
        table: "cycle_task",
        kind: "changed",
        key: task.id,
        fields: ["cycleId"],
        before: { cycleId: sprintA.id },
        where: { cycleId: sprintB.id },
      },
    ],
    afterUndo: () => [],
  },
  {
    name: "asking for what is already there changes nothing",
    seed: async ({ s, task, team }) => {
      await s.ok(s.mia, "PUT", "/custom-field/value", {
        taskId: task.id,
        fieldId: team.id,
        value: "Core",
      });
    },
    turns: ({ task }) => [
      {
        tools: [
          {
            name: "set_custom_field",
            input: { task: task.id, field: "Team", value: "core" },
          },
        ],
      },
      { text: "Already set." },
    ],
    expected: () => [],
    check: (run) => {
      expect(run.steps.find((step) => step.kind === "tool")?.status).toBe("ok");
    },
  },
  {
    name: "a read-only agent cannot write, whatever the model asks",
    agent: { role: "viewer" },
    turns: ({ task }) => [
      {
        tools: [
          {
            name: "set_custom_field",
            input: { task: task.id, field: "Team", value: "Core" },
          },
          { name: "create_task", input: { title: "Sneaky" } },
        ],
      },
      { text: "Could not." },
    ],
    expected: () => [],
  },
  {
    // Members can't delete tasks, so neither can an agent working for one:
    // the run's rights are the agent's role capped at the person's.
    name: "an agent working for a member cannot delete a task",
    turns: ({ task }) => [
      { tools: [{ name: "delete_task", input: { task: task.id } }] },
      { text: "Could not delete it." },
    ],
    expected: () => [],
    check: (run) => {
      const step = run.steps.find((s) => s.kind === "tool");
      expect(step?.status).toBe("denied");
      expect(step?.approval).toBeNull();
    },
  },
  {
    name: "a destructive change waits for approval and applies only once approved",
    turns: ({ task, other }) => [
      {
        tools: [
          {
            name: "bulk_move_status",
            input: { tasks: [task.id, other.id], status: "done" },
          },
        ],
      },
      { text: "Asked to close both." },
    ],
    expected: () => [],
    check: (run) => {
      const step = run.steps.find((s) => s.kind === "tool");
      expect(step?.status).toBe("pending");
      expect(step?.approval?.canDecide).toBe(true);
    },
  },
];

async function runScenario(scenario: Scenario) {
  const scene = await evalScene(scenario.agent);
  await scenario.seed?.(scene);
  const before = await snapshotWorkspace(scene.s.workspaceId);
  scriptModel(scenario.turns(scene));
  const run = await runAgent(
    scene.s,
    scene.s.mia,
    scene.bot.id,
    scene.task.id,
    "Please do it.",
  );
  const after = await snapshotWorkspace(scene.s.workspaceId);
  const score = scoreDiff(
    diffSnapshots(before, after),
    scenario.expected(scene),
  );
  scenario.check?.(run, scene);
  let undoScore = null;
  if (scenario.afterUndo) {
    await undoRun(scene.s, scene.s.mia, run);
    const undone = await snapshotWorkspace(scene.s.workspaceId);
    undoScore = scoreDiff(
      diffSnapshots(before, undone),
      scenario.afterUndo(scene),
    );
  }
  return { scene, run, before, score, undoScore };
}

describe("agent eval: state-diff scenarios, pass^k", () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const results: boolean[] = [];
      for (let attempt = 0; attempt < K; attempt++) {
        const { score, undoScore } = await runScenario(scenario);
        // On failure, the diff says exactly what went wrong.
        expect({
          missing: score.missing,
          unexpected: score.unexpected,
        }).toEqual({
          missing: [],
          unexpected: [],
        });
        if (undoScore) {
          expect({
            missing: undoScore.missing,
            unexpected: undoScore.unexpected,
          }).toEqual({ missing: [], unexpected: [] });
        }
        results.push(score.pass && (undoScore?.pass ?? true));
      }
      expect(reliability(results)).toMatchObject({ k: K, passHatK: true });
    });
  }

  it("approving the held bulk move changes exactly those tasks", async () => {
    const scenario = SCENARIOS.find((s) => s.name.startsWith("a destructive"));
    if (!scenario) throw new Error("scenario missing");
    const { scene, run, before } = await runScenario(scenario);
    const step = run.steps.find((s) => s.kind === "tool");
    await scene.s.ok(
      scene.s.mia,
      "POST",
      `/ai/agents/approvals/${step?.approval?.id}/approve`,
      {
        workspaceId: scene.s.workspaceId,
      },
    );
    await drainAgentRuns();
    const after = await snapshotWorkspace(scene.s.workspaceId);
    expect(
      scoreDiff(
        diffSnapshots(before, after),
        [scene.task.id, scene.other.id].map((key) => ({
          table: "task",
          kind: "changed" as const,
          key,
          fields: ["status"],
          before: { status: "to-do" },
          where: { status: "done" },
        })),
      ),
    ).toMatchObject({ pass: true });
  });

  it("scores collateral damage as a failure", async () => {
    // The model does what was asked, and also changes the priority.
    const scenario = SCENARIOS.find((s) => s.name.startsWith("triages"));
    if (!scenario) throw new Error("scenario missing");
    const overeager: Scenario = {
      ...scenario,
      turns: (scene) => [
        ...scenario.turns(scene).slice(0, 1),
        {
          tools: [
            {
              name: "update_task",
              input: { task: scene.task.id, priority: "urgent" },
            },
          ],
        },
        { text: "Triaged, and bumped it." },
      ],
      afterUndo: undefined,
    };
    const { score } = await runScenario(overeager);
    expect(score.pass).toBe(false);
    expect(score.missing).toEqual([]);
    expect(score.unexpected).toEqual([
      expect.objectContaining({
        table: "task",
        kind: "changed",
        fields: ["priority"],
      }),
    ]);
  });

  it("keeps the eval rows to the scene's workspace", async () => {
    const { scene } = await runScenario(SCENARIOS[0] as Scenario);
    const other = await snapshotWorkspace(scene.s.outsiderWorkspaceId);
    expect(
      Object.values(other).every((rows) => Object.keys(rows).length === 0),
    ).toBe(true);
    // The harness reads only explicit columns, so this stays a plain count.
    const tasks = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable);
    expect(tasks.length).toBeGreaterThan(0);
  });
});
