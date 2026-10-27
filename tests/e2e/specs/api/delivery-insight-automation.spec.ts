import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type Project,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Computed planning reads and project automation, all without AI: delivery
// forecasts and risk radars (cycle, module, project, Home), planning
// insights (estimate suggestion and calibration, cycle capacity, retro
// facts, My brief), automation rules and their runs, saved analytics
// reports and similar-task hints. Everything runs in a workspace this file
// owns, so the computed numbers only see its own tasks.

type Forecast = {
  scope: {
    type: "cycle" | "module" | "project";
    id: string;
    projectId: string;
    endDate: string | null;
  };
  status: "ok" | "insufficient_history" | "complete";
  reason: string | null;
  today: string;
  remaining: number;
  history: { days: number; completed: number };
  p50: unknown;
  p85: unknown;
  p95: unknown;
  probabilityByEnd: number | null;
  beyondHorizon: boolean;
  method: { name: string; iterations: number; seed: number };
};
type Signal = {
  kind: string;
  severity: "high" | "medium" | "low";
  taskIds: string[];
  total: number;
  headTaskId?: string | null;
  deadline?: string;
};
type RiskRadar = {
  scope: Forecast["scope"];
  today: string;
  truncated: boolean;
  hiddenBlockers: number;
  signals: Signal[];
  tasks: { id: string; projectId: string; title: string }[];
};
type HomeRisks = {
  today: string;
  cycles: number;
  signals: (Signal & { projectId: string; cycleId: string })[];
  tasks: { id: string }[];
};
type Cycle = { id: string; status: string; startDate: string | null };
type Module = { id: string; targetDate: string | null };
type Estimate = {
  id: string;
  type: string;
  points: { id: string; value: string }[];
};
type Rule = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: { type: string };
  runCount: number;
  lastOutcome: string | null;
};
type Run = {
  id: string;
  ruleId: string;
  ruleName: string;
  taskId: string | null;
  taskKey: string | null;
  triggerType: string;
  outcome: string;
  actions: { type: string; status: string }[];
};
type Report = {
  id: string;
  workspaceId: string;
  name: string;
  visibility: "private" | "workspace";
  owner: { id: string; name: string } | null;
  isOwner: boolean;
  canDelete: boolean;
  config: { xAxis: string; scope?: { projectIds: string[] } };
  droppedProjectCount: number;
};

/** A calendar day (YYYY-MM-DD), UTC, `offset` days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const noon = (offset: number) => `${day(offset)}T12:00:00.000Z`;

let world: World;
let outsider: TestUser;
let project: Project;
let cycle: Cycle;
let draftCycle: Cycle;
let doneModule: Module;
let openModule: Module;
let tasks: {
  done: Task;
  overdue: Task;
  dueSoon: Task;
  blocker: Task;
  blocked: Task;
  mine: Task;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Delivery");
  outsider = await signUpUser("Delivery outsider");
  const owner = world.as("owner");
  project = await createProject(owner, world.workspace.id);
  tasks = {
    done: await createTask(owner, project.id, { status: "done" }),
    overdue: await createTask(owner, project.id, { dueDate: noon(-3) }),
    dueSoon: await createTask(owner, project.id, { dueDate: noon(1) }),
    blocker: await createTask(owner, project.id, { status: "in-progress" }),
    blocked: await createTask(owner, project.id),
    mine: await createTask(owner, project.id, {
      title: uniqueName("Brief overdue"),
      dueDate: noon(-2),
      assigneeIds: [world.users.member.id],
    }),
  };
  await expectJson(
    await owner.post("/api/task-relation", {
      data: {
        sourceTaskId: tasks.blocker.id,
        targetTaskId: tasks.blocked.id,
        relationType: "blocks",
      },
    }),
  );

  cycle = await expectJson<Cycle>(
    await owner.post(`/api/cycle/project/${project.id}`, {
      data: {
        name: uniqueName("Radar cycle"),
        startDate: day(-2),
        endDate: day(2),
      },
    }),
  );
  draftCycle = await expectJson<Cycle>(
    await owner.post(`/api/cycle/project/${project.id}`, {
      data: { name: uniqueName("Draft cycle") },
    }),
  );
  await expectJson(
    await owner.post(`/api/cycle/${cycle.id}/tasks`, {
      data: {
        taskIds: [
          tasks.done.id,
          tasks.overdue.id,
          tasks.dueSoon.id,
          tasks.blocker.id,
          tasks.blocked.id,
        ],
      },
    }),
  );

  doneModule = await expectJson<Module>(
    await owner.post(`/api/module/project/${project.id}`, {
      data: { name: uniqueName("Shipped module"), targetDate: day(20) },
    }),
  );
  openModule = await expectJson<Module>(
    await owner.post(`/api/module/project/${project.id}`, {
      data: { name: uniqueName("Open module"), targetDate: day(30) },
    }),
  );
  await expectJson(
    await owner.post(`/api/module/${doneModule.id}/tasks`, {
      data: { taskIds: [tasks.done.id] },
    }),
  );
  await expectJson(
    await owner.post(`/api/module/${openModule.id}/tasks`, {
      data: { taskIds: [tasks.blocker.id, tasks.blocked.id] },
    }),
  );
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
  await world?.dispose();
});

test.describe("delivery forecast", () => {
  test(
    "forecast a project, a cycle and a module from their own history",
    covers("getProjectForecast", "getCycleForecast", "getModuleForecast"),
    async () => {
      const member = world.as("member");
      const projectForecast = await expectJson<Forecast>(
        await member.get(`/api/delivery/project/${project.id}/forecast`),
      );
      // A project created today has no past days to replay.
      expect(projectForecast).toMatchObject({
        scope: { type: "project", id: project.id, endDate: null },
        status: "insufficient_history",
        reason: "short_span",
        today: day(0),
        remaining: 5,
        p50: null,
        p85: null,
        p95: null,
        probabilityByEnd: null,
        method: { name: "monte_carlo_daily_throughput", iterations: 10_000 },
      });
      expect(projectForecast.history.days).toBe(0);

      const cycleForecast = await expectJson<Forecast>(
        await member.get(`/api/delivery/cycle/${cycle.id}/forecast`),
      );
      expect(cycleForecast).toMatchObject({
        scope: {
          type: "cycle",
          id: cycle.id,
          projectId: project.id,
          endDate: day(2),
        },
        status: "insufficient_history",
        remaining: 4,
      });
      // Seeded by scope, day and open count: stable within the day.
      const again = await expectJson<Forecast>(
        await member.get(`/api/delivery/cycle/${cycle.id}/forecast`),
      );
      expect(again.method.seed).toBe(cycleForecast.method.seed);

      // Every task of the module is done.
      const shipped = await expectJson<Forecast>(
        await member.get(`/api/delivery/module/${doneModule.id}/forecast`),
      );
      expect(shipped).toMatchObject({
        scope: { type: "module", id: doneModule.id, endDate: day(20) },
        status: "complete",
        reason: null,
        remaining: 0,
        probabilityByEnd: 1,
      });
      const open = await expectJson<Forecast>(
        await member.get(`/api/delivery/module/${openModule.id}/forecast`),
      );
      expect(open).toMatchObject({
        status: "insufficient_history",
        remaining: 2,
      });
    },
  );

  test("forecast access: roles, outsiders, unknown ids and the feature gate", async () => {
    const paths = [
      `/api/delivery/project/${project.id}/forecast`,
      `/api/delivery/cycle/${cycle.id}/forecast`,
      `/api/delivery/module/${openModule.id}/forecast`,
    ];
    for (const path of paths) {
      // Viewers have no analytics:read.
      await expectStatus(await world.as("viewer").get(path), 403);
      await expectStatus(await world.as("anonymous").get(path), 401);
      await expectStatus(await outsider.ctx.get(path), [403, 404]);
    }
    const owner = world.as("owner");
    expect(
      await expectStatus(
        await owner.get("/api/delivery/project/e2e-unknown-project/forecast"),
        404,
      ),
    ).toContain("Project not found");
    await expectStatus(
      await owner.get("/api/delivery/cycle/e2e-unknown-cycle/forecast"),
      404,
    );
    await expectStatus(
      await owner.get("/api/delivery/module/e2e-unknown-module/forecast"),
      404,
    );

    await expectJson(
      await owner.patch(`/api/project/${project.id}/features`, {
        data: { cyclesEnabled: false, modulesEnabled: false },
      }),
    );
    try {
      await expectStatus(
        await owner.get(`/api/delivery/cycle/${cycle.id}/forecast`),
        403,
      );
      await expectStatus(
        await owner.get(`/api/delivery/module/${openModule.id}/risks`),
        403,
      );
      // The project forecast has no feature gate.
      await expectJson(
        await owner.get(`/api/delivery/project/${project.id}/forecast`),
      );
    } finally {
      await expectJson(
        await owner.patch(`/api/project/${project.id}/features`, {
          data: { cyclesEnabled: true, modulesEnabled: true },
        }),
      );
    }
  });
});

test.describe("risk radar", () => {
  const signal = (radar: { signals: Signal[] }, kind: string) =>
    radar.signals.find((entry) => entry.kind === kind);

  test(
    "project, cycle and module risks name blocked, overdue and unassigned work",
    covers("getProjectRisks", "getCycleRisks", "getModuleRisks"),
    async () => {
      const member = world.as("member");
      const projectRisks = await expectJson<RiskRadar>(
        await member.get(`/api/delivery/project/${project.id}/risks`),
      );
      expect(projectRisks).toMatchObject({
        scope: { type: "project", id: project.id, endDate: null },
        today: day(0),
        truncated: false,
        hiddenBlockers: 0,
      });
      expect(signal(projectRisks, "blocked_chain")).toMatchObject({
        taskIds: [tasks.blocked.id],
        headTaskId: tasks.blocker.id,
      });
      // Two overdue tasks with different first assignees: no cluster.
      expect(signal(projectRisks, "overdue")?.taskIds.sort()).toEqual(
        [tasks.overdue.id, tasks.mine.id].sort(),
      );
      expect(signal(projectRisks, "unassigned_near_deadline")).toMatchObject({
        taskIds: [tasks.dueSoon.id],
        severity: "high",
        deadline: day(1),
      });
      const named = projectRisks.tasks.map((task) => task.id);
      expect(named).toEqual(
        expect.arrayContaining([
          tasks.blocked.id,
          tasks.blocker.id,
          tasks.overdue.id,
          tasks.dueSoon.id,
        ]),
      );
      expect(named).not.toContain(tasks.done.id);
      // Ordered by severity.
      const ranks = projectRisks.signals.map((entry) =>
        ["high", "medium", "low"].indexOf(entry.severity),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

      const cycleRisks = await expectJson<RiskRadar>(
        await member.get(`/api/delivery/cycle/${cycle.id}/risks`),
      );
      expect(cycleRisks.scope).toMatchObject({
        type: "cycle",
        id: cycle.id,
        endDate: day(2),
      });
      // The cycle's end (in 2 days) is near for every unassigned open task.
      expect(signal(cycleRisks, "unassigned_near_deadline")?.taskIds).toEqual(
        expect.arrayContaining([tasks.dueSoon.id, tasks.blocked.id]),
      );
      // The member's overdue task is not in the cycle.
      expect(signal(cycleRisks, "overdue")?.taskIds).toEqual([
        tasks.overdue.id,
      ]);

      const moduleRisks = await expectJson<RiskRadar>(
        await member.get(`/api/delivery/module/${openModule.id}/risks`),
      );
      expect(moduleRisks.scope).toMatchObject({
        type: "module",
        id: openModule.id,
        endDate: day(30),
      });
      expect(signal(moduleRisks, "blocked_chain")).toMatchObject({
        taskIds: [tasks.blocked.id],
        headTaskId: tasks.blocker.id,
      });
      expect(signal(moduleRisks, "overdue")).toBeUndefined();
    },
  );

  test(
    "Home lists the top risks of current cycles",
    covers("getHomeRisks"),
    async () => {
      const home = await expectJson<HomeRisks>(
        await world.as("member").get("/api/delivery/home/risks", {
          params: { workspaceId: world.workspace.id },
        }),
      );
      expect(home.today).toBe(day(0));
      expect(home.cycles).toBe(1);
      expect(home.signals.length).toBeGreaterThan(0);
      expect(home.signals.length).toBeLessThanOrEqual(8);
      for (const entry of home.signals) {
        expect(entry).toMatchObject({
          projectId: project.id,
          cycleId: cycle.id,
        });
      }
      expect(home.signals.map((entry) => entry.kind)).toContain(
        "unassigned_near_deadline",
      );

      await expectStatus(
        await world.as("viewer").get("/api/delivery/home/risks", {
          params: { workspaceId: world.workspace.id },
        }),
        403,
      );
      await expectStatus(
        await world.as("anonymous").get("/api/delivery/home/risks", {
          params: { workspaceId: world.workspace.id },
        }),
        401,
      );
      await expectStatus(
        await outsider.ctx.get("/api/delivery/home/risks", {
          params: { workspaceId: world.workspace.id },
        }),
        403,
      );
    },
  );

  test("risk access: roles and unknown ids", async () => {
    const owner = world.as("owner");
    await expectStatus(
      await world.as("viewer").get(`/api/delivery/project/${project.id}/risks`),
      403,
    );
    await expectStatus(
      await world.as("viewer").get(`/api/delivery/cycle/${cycle.id}/risks`),
      403,
    );
    await expectStatus(
      await outsider.ctx.get(`/api/delivery/cycle/${cycle.id}/risks`),
      [403, 404],
    );
    expect(
      await expectStatus(
        await owner.get("/api/delivery/project/e2e-unknown-project/risks"),
        404,
      ),
    ).toContain("Project not found");
    await expectStatus(
      await owner.get("/api/delivery/cycle/e2e-unknown-cycle/risks"),
      404,
    );
    await expectStatus(
      await owner.get("/api/delivery/module/e2e-unknown-module/risks"),
      404,
    );
  });
});

test.describe("planning insights", () => {
  let estimateProject: Project;
  let estimate: Estimate;
  const theme = `Ledger${Math.random().toString(36).slice(2, 7)}`;

  test.beforeAll(async () => {
    const owner = world.as("owner");
    estimateProject = await createProject(owner, world.workspace.id);
    await expectJson(
      await owner.patch(`/api/project/${estimateProject.id}/features`, {
        data: { estimatesEnabled: true },
      }),
    );
    estimate = await expectJson<Estimate>(
      await owner.post(`/api/estimate/${estimateProject.id}`, {
        data: { name: "Points", type: "points", values: ["1", "2", "3", "5"] },
      }),
    );
    const point = (value: string) =>
      estimate.points.find((entry) => entry.value === value)?.id ?? null;
    for (const [suffix, value] of [
      ["reconciliation export", "3"],
      ["reconciliation import", "3"],
      ["reconciliation report", "3"],
      ["reconciliation cleanup", "5"],
    ] as const) {
      await createTask(owner, estimateProject.id, {
        title: `${theme} ${suffix}`,
        status: "done",
        estimatePointId: point(value),
      });
    }
  });

  test(
    "suggest an estimate from similar finished tasks",
    covers("getEstimateSuggestion"),
    async () => {
      // Viewers may ask: the suggestion needs task:read only.
      const viewer = world.as("viewer");
      const suggestion = await eventually(
        async () => {
          const body = await expectJson<{
            status: string;
            estimateType: string | null;
            suggestion: { value: string; matches: number } | null;
            similar: { title: string; value: string; projectId: string }[];
          }>(
            await viewer.get(
              `/api/insight/estimate/project/${estimateProject.id}/suggestion`,
              { params: { title: `${theme} reconciliation` } },
            ),
          );
          return body.status === "ok" ? body : null;
        },
        { what: "an estimate suggestion" },
      );
      expect(suggestion.estimateType).toBe("points");
      expect(suggestion.suggestion?.value).toBe("3");
      expect(suggestion.suggestion?.matches).toBeGreaterThanOrEqual(3);
      expect(suggestion.similar.length).toBe(4);
      for (const entry of suggestion.similar) {
        expect(entry.title).toContain(theme);
        expect(entry.projectId).toBe(estimateProject.id);
      }

      // Nothing similar to compare with.
      const unknown = await expectJson<{ status: string; suggestion: null }>(
        await viewer.get(
          `/api/insight/estimate/project/${estimateProject.id}/suggestion`,
          { params: { title: "Quokka zeppelin" } },
        ),
      );
      expect(unknown).toMatchObject({
        status: "insufficient_history",
        suggestion: null,
      });

      await expectStatus(
        await viewer.get(
          `/api/insight/estimate/project/${estimateProject.id}/suggestion`,
        ),
        400,
      );
      await expectStatus(
        await viewer.get(
          `/api/insight/estimate/project/${estimateProject.id}/suggestion`,
          { params: { taskId: "e2e-unknown-task" } },
        ),
        404,
      );
      // The first project has estimates off.
      await expectStatus(
        await viewer.get(
          `/api/insight/estimate/project/${project.id}/suggestion`,
          { params: { title: "anything" } },
        ),
        403,
      );
      expect(
        await expectStatus(
          await viewer.get(
            "/api/insight/estimate/project/e2e-unknown-project/suggestion",
            { params: { title: "anything" } },
          ),
          404,
        ),
      ).toContain("Project not found");
      await expectStatus(
        await outsider.ctx.get(
          `/api/insight/estimate/project/${estimateProject.id}/suggestion`,
          { params: { title: "anything" } },
        ),
        [403, 404],
      );
    },
  );

  test(
    "estimate calibration buckets the active system's values",
    covers("getEstimateCalibration"),
    async () => {
      const calibration = await expectJson<{
        status: string;
        estimateType: string | null;
        estimateName: string | null;
        windowDays: number;
        samples: number;
        unmeasured: number;
        buckets: { id: string; value: string; samples: number }[];
      }>(
        await world
          .as("member")
          .get(
            `/api/insight/estimate/project/${estimateProject.id}/calibration`,
          ),
      );
      expect(calibration).toMatchObject({
        status: "ok",
        estimateType: "points",
        estimateName: "Points",
        windowDays: 180,
      });
      expect(calibration.buckets.map((bucket) => bucket.value)).toEqual([
        "1",
        "2",
        "3",
        "5",
      ]);
      // Four completed, estimated tasks: measured or not.
      expect(calibration.samples + calibration.unmeasured).toBe(4);

      // Viewers have no analytics:read; the feature gate answers 403.
      await expectStatus(
        await world
          .as("viewer")
          .get(
            `/api/insight/estimate/project/${estimateProject.id}/calibration`,
          ),
        403,
      );
      await expectStatus(
        await world
          .as("member")
          .get(`/api/insight/estimate/project/${project.id}/calibration`),
        403,
      );
      expect(
        await expectStatus(
          await world
            .as("member")
            .get(
              "/api/insight/estimate/project/e2e-unknown-project/calibration",
            ),
          404,
        ),
      ).toContain("Project not found");
    },
  );

  test(
    "cycle capacity counts the committed work",
    covers("getCycleCapacity"),
    async () => {
      const capacity = await expectJson<{
        cycleId: string;
        plannedDays: number | null;
        basis: string;
        unit: string;
        committed: { tasks: number };
        status: string;
        members: unknown[] | null;
      }>(
        await world.as("owner").get(`/api/insight/capacity/cycle/${cycle.id}`),
      );
      expect(capacity).toMatchObject({
        cycleId: cycle.id,
        plannedDays: 5,
        // No ended cycles and no throughput history yet.
        basis: "none",
        status: "unknown",
        unit: "tasks",
        committed: { tasks: 5 },
      });
      // Per-assignee load needs cycle:update, which the owner has.
      expect(Array.isArray(capacity.members)).toBe(true);

      await expectStatus(
        await world.as("viewer").get(`/api/insight/capacity/cycle/${cycle.id}`),
        403,
      );
      await expectStatus(
        await world
          .as("anonymous")
          .get(`/api/insight/capacity/cycle/${cycle.id}`),
        401,
      );
      await expectStatus(
        await world.as("owner").get("/api/insight/capacity/cycle/e2e-unknown"),
        404,
      );
    },
  );

  test(
    "retrospective facts of a dated cycle",
    covers("getRetroFacts"),
    async () => {
      const facts = await expectJson<{
        cycle: { id: string; projectId: string; status: string };
        counts: { completed: number; leftOpen: number; committed: number };
        leftOpen: { total: number; tasks: { id: string }[] };
        forecast: { endDate: string };
      }>(await world.as("member").get(`/api/insight/retro/cycle/${cycle.id}`));
      expect(facts.cycle).toMatchObject({
        id: cycle.id,
        projectId: project.id,
        status: "current",
      });
      expect(facts.forecast.endDate).toBe(day(2));
      expect(facts.counts.completed).toBe(1);
      expect(
        facts.counts.completed + facts.counts.leftOpen,
      ).toBeLessThanOrEqual(5);

      // A draft has no dates to look back on.
      expect(
        await expectStatus(
          await world
            .as("member")
            .get(`/api/insight/retro/cycle/${draftCycle.id}`),
          409,
        ),
      ).toContain("dates");
      await expectStatus(
        await world.as("viewer").get(`/api/insight/retro/cycle/${cycle.id}`),
        403,
      );
      await expectStatus(
        await outsider.ctx.get(`/api/insight/retro/cycle/${cycle.id}`),
        [403, 404],
      );
      await expectStatus(
        await world.as("member").get("/api/insight/retro/cycle/e2e-unknown"),
        404,
      );
    },
  );

  test("My brief lists my overdue work", covers("getMyBrief"), async () => {
    const brief = await expectJson<{
      today: string;
      timeZone: string;
      dueToday: { total: number };
      overdue: { total: number; items: { id: string; projectId: string }[] };
    }>(
      await world.as("member").get("/api/insight/my-brief", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(brief.overdue.items.map((item) => item.id)).toEqual([tasks.mine.id]);
    expect(brief.overdue.total).toBe(1);
    expect(brief.overdue.items[0]?.projectId).toBe(project.id);

    // Personal: the owner is assigned nothing.
    const ownerBrief = await expectJson<{ overdue: { total: number } }>(
      await world.as("owner").get("/api/insight/my-brief", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(ownerBrief.overdue.total).toBe(0);

    await expectStatus(
      await world.as("member").get("/api/insight/my-brief"),
      400,
    );
    await expectStatus(
      await world.as("anonymous").get("/api/insight/my-brief", {
        params: { workspaceId: world.workspace.id },
      }),
      401,
    );
    await expectStatus(
      await outsider.ctx.get("/api/insight/my-brief", {
        params: { workspaceId: world.workspace.id },
      }),
      403,
    );
  });
});

test.describe("automation rules", () => {
  let automationProject: Project;
  let rule: Rule;
  const marker = `Escalate${Math.random().toString(36).slice(2, 7)}`;
  const label = uniqueName("Escalated").slice(0, 40);

  test.beforeAll(async () => {
    automationProject = await createProject(
      world.as("owner"),
      world.workspace.id,
    );
  });

  const base = () => `/api/automation-rule/${automationProject.id}`;

  test(
    "a rule acts on a new matching task and logs a run",
    covers("createAutomationRule", "listAutomationRules", "listAutomationRuns"),
    async () => {
      const owner = world.as("owner");
      const empty = await expectJson<{ rules: Rule[] }>(
        await world.as("viewer").get(base()),
      );
      expect(empty.rules).toEqual([]);

      const definition = {
        name: "Escalate flagged work",
        trigger: { type: "task_created" },
        conditions: {
          op: "and",
          conditions: [{ field: "title", op: "contains", value: marker }],
        },
        actions: [
          { type: "set_priority", priority: "urgent" },
          { type: "add_label", label },
        ],
      };
      // Managing rules needs project:update.
      await expectStatus(
        await world.as("member").post(base(), { data: definition }),
        403,
      );
      await expectStatus(
        await owner.post(base(), {
          data: {
            ...definition,
            actions: [{ type: "set_status", columnId: "e2e-unknown-column" }],
          },
        }),
        400,
      );
      await expectStatus(
        await owner.post(base(), { data: { ...definition, actions: [] } }),
        400,
      );

      rule = await expectJson<Rule>(
        await world.as("admin").post(base(), { data: definition }),
      );
      expect(rule).toMatchObject({
        projectId: automationProject.id,
        name: "Escalate flagged work",
        enabled: true,
        trigger: { type: "task_created" },
        runCount: 0,
        lastOutcome: null,
      });
      const listed = await expectJson<{ rules: Rule[] }>(
        await world.as("viewer").get(base()),
      );
      expect(listed.rules.map((entry) => entry.id)).toEqual([rule.id]);

      const routine = await createTask(owner, automationProject.id, {
        title: uniqueName("Routine work"),
        priority: "low",
      });
      const flagged = await createTask(owner, automationProject.id, {
        title: `${marker} login crash`,
        priority: "low",
      });

      const run = await eventually(
        async () => {
          const { runs } = await expectJson<{ runs: Run[] }>(
            await world
              .as("viewer")
              .get(`${base()}/runs`, { params: { ruleId: rule.id } }),
          );
          return runs.find((entry) => entry.taskId === flagged.id);
        },
        { what: "the automation run" },
      );
      expect(run).toMatchObject({
        ruleId: rule.id,
        ruleName: "Escalate flagged work",
        triggerType: "task_created",
        outcome: "success",
        actions: [
          { type: "set_priority", status: "applied" },
          { type: "add_label", status: "applied" },
        ],
      });
      expect(run.taskKey).toMatch(/^[A-Z0-9]+-\d+$/);

      const after = await expectJson<Task>(
        await owner.get(`/api/task/${flagged.id}`),
      );
      expect(after.priority).toBe("urgent");
      const labels = await expectJson<{ name: string }[]>(
        await owner.get(`/api/label/task/${flagged.id}`),
      );
      expect(labels.map((entry) => entry.name)).toContain(label);

      // The condition kept the routine task out.
      const untouched = await expectJson<Task>(
        await owner.get(`/api/task/${routine.id}`),
      );
      expect(untouched.priority).toBe("low");
      const { runs } = await expectJson<{ runs: Run[] }>(
        await owner.get(`${base()}/runs`, { params: { limit: 100 } }),
      );
      expect(runs.map((entry) => entry.taskId)).not.toContain(routine.id);

      const counted = await expectJson<{ rules: Rule[] }>(
        await owner.get(base()),
      );
      expect(counted.rules[0]).toMatchObject({
        runCount: 1,
        lastOutcome: "success",
      });

      await expectStatus(
        await owner.get(`${base()}/runs`, { params: { limit: 0 } }),
        400,
      );
      await expectStatus(await outsider.ctx.get(base()), [403, 404]);
    },
  );

  test(
    "turn a rule off, rename it and delete it",
    covers("updateAutomationRule", "deleteAutomationRule"),
    async () => {
      const owner = world.as("owner");
      await expectStatus(
        await world
          .as("member")
          .patch(`${base()}/${rule.id}`, { data: { enabled: false } }),
        403,
      );
      const off = await expectJson<Rule>(
        await owner.patch(`${base()}/${rule.id}`, {
          data: { enabled: false, name: "Escalate (paused)" },
        }),
      );
      expect(off).toMatchObject({
        id: rule.id,
        enabled: false,
        name: "Escalate (paused)",
      });

      // A paused rule does not act. The engine runs on a later tick, so a
      // second, unconditional probe rule proves the tick happened.
      const probe = await expectJson<Rule>(
        await owner.post(base(), {
          data: {
            name: "Probe",
            trigger: { type: "task_created" },
            actions: [{ type: "set_priority", priority: "high" }],
          },
        }),
      );
      const paused = await createTask(owner, automationProject.id, {
        title: `${marker} while paused`,
        priority: "low",
      });
      await eventually(
        async () => {
          const { runs } = await expectJson<{ runs: Run[] }>(
            await owner.get(`${base()}/runs`, { params: { ruleId: probe.id } }),
          );
          return runs.some((entry) => entry.taskId === paused.id);
        },
        { what: "the probe rule's run" },
      );
      const pausedTask = await expectJson<Task>(
        await owner.get(`/api/task/${paused.id}`),
      );
      expect(pausedTask.priority).toBe("high");
      const pausedLabels = await expectJson<{ name: string }[]>(
        await owner.get(`/api/label/task/${paused.id}`),
      );
      expect(pausedLabels.map((entry) => entry.name)).not.toContain(label);
      const ruleRuns = await expectJson<{ runs: Run[] }>(
        await owner.get(`${base()}/runs`, { params: { ruleId: rule.id } }),
      );
      expect(ruleRuns.runs.map((entry) => entry.taskId)).not.toContain(
        paused.id,
      );

      // Back on, then gone.
      const on = await expectJson<Rule>(
        await owner.patch(`${base()}/${rule.id}`, { data: { enabled: true } }),
      );
      expect(on.enabled).toBe(true);
      await expectStatus(
        await owner.patch(`${base()}/${rule.id}`, {
          data: { actions: [{ type: "move_to_cycle", cycleId: cycle.id }] },
        }),
        400,
      );

      await expectStatus(
        await world.as("member").delete(`${base()}/${rule.id}`),
        403,
      );
      for (const id of [rule.id, probe.id]) {
        expect(
          await expectJson<{ id: string; deleted: boolean }>(
            await owner.delete(`${base()}/${id}`),
          ),
        ).toEqual({ id, deleted: true });
      }
      const listed = await expectJson<{ rules: Rule[] }>(
        await owner.get(base()),
      );
      expect(listed.rules).toEqual([]);
      await expectStatus(await owner.delete(`${base()}/${rule.id}`), 404);
      await expectStatus(
        await owner.patch(`${base()}/${rule.id}`, { data: { enabled: false } }),
        404,
      );
      // Deleting a rule deletes its run history.
      const { runs } = await expectJson<{ runs: Run[] }>(
        await owner.get(`${base()}/runs`),
      );
      expect(runs).toEqual([]);
    },
  );

  test("unknown projects answer 404", async () => {
    const owner = world.as("owner");
    const unknown = "/api/automation-rule/e2e-unknown-project";
    for (const response of [
      await owner.get(unknown),
      await owner.get(`${unknown}/runs`),
      await owner.post(unknown, {
        data: {
          name: "Nowhere",
          trigger: { type: "task_created" },
          actions: [{ type: "set_priority", priority: "high" }],
        },
      }),
      await owner.patch(`${unknown}/e2e-rule`, { data: { enabled: false } }),
      await owner.delete(`${unknown}/e2e-rule`),
    ]) {
      expect(await expectStatus(response, 404)).toContain("Project not found");
    }
  });
});

test.describe("saved analytics reports", () => {
  let report: Report;

  test(
    "save a private report, share it, edit it and delete it",
    covers(
      "createAnalyticsReport",
      "listAnalyticsReports",
      "getAnalyticsReport",
      "updateAnalyticsReport",
      "deleteAnalyticsReport",
    ),
    async () => {
      const member = world.as("member");
      const workspaceId = world.workspace.id;
      report = await expectJson<Report>(
        await member.post("/api/analytics-report", {
          data: {
            workspaceId,
            name: "Priority mix",
            config: {
              xAxis: "priority",
              scope: { projectIds: [project.id] },
            },
          },
        }),
      );
      expect(report).toMatchObject({
        workspaceId,
        name: "Priority mix",
        visibility: "private",
        owner: { id: world.users.member.id },
        isOwner: true,
        canDelete: true,
        config: { xAxis: "priority", scope: { projectIds: [project.id] } },
        droppedProjectCount: 0,
      });

      const mine = await expectJson<Report[]>(
        await member.get("/api/analytics-report", { params: { workspaceId } }),
      );
      expect(mine.map((entry) => entry.id)).toContain(report.id);
      const read = await expectJson<Report>(
        await member.get(`/api/analytics-report/${report.id}`),
      );
      expect(read.name).toBe("Priority mix");

      // Private: nobody else sees it, admins included.
      const admin = world.as("admin");
      const adminList = await expectJson<Report[]>(
        await admin.get("/api/analytics-report", { params: { workspaceId } }),
      );
      expect(adminList.map((entry) => entry.id)).not.toContain(report.id);
      await expectStatus(
        await admin.get(`/api/analytics-report/${report.id}`),
        404,
      );

      const shared = await expectJson<Report>(
        await member.patch(`/api/analytics-report/${report.id}`, {
          data: {
            name: "Priority mix (team)",
            visibility: "workspace",
            config: { xAxis: "assignee" },
          },
        }),
      );
      expect(shared).toMatchObject({
        name: "Priority mix (team)",
        visibility: "workspace",
        config: { xAxis: "assignee" },
      });
      expect(shared.config.scope).toBeUndefined();

      const seen = await expectJson<Report>(
        await admin.get(`/api/analytics-report/${report.id}`),
      );
      expect(seen).toMatchObject({ isOwner: false, canDelete: true });
      const ownerView = await expectJson<Report[]>(
        await world
          .as("owner")
          .get("/api/analytics-report", { params: { workspaceId } }),
      );
      expect(ownerView.map((entry) => entry.id)).toContain(report.id);
      // Only the owner edits it.
      await expectStatus(
        await admin.patch(`/api/analytics-report/${report.id}`, {
          data: { name: "Hijacked" },
        }),
        403,
      );

      const deleted = await expectJson<{ id: string }>(
        await member.delete(`/api/analytics-report/${report.id}`),
      );
      expect(deleted).toEqual({ id: report.id });
      await expectStatus(
        await member.get(`/api/analytics-report/${report.id}`),
        404,
      );
      const gone = await expectJson<Report[]>(
        await member.get("/api/analytics-report", { params: { workspaceId } }),
      );
      expect(gone.map((entry) => entry.id)).not.toContain(report.id);
    },
  );

  test("report validation and roles", async () => {
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    // Viewers have no analytics:read.
    await expectStatus(
      await world
        .as("viewer")
        .get("/api/analytics-report", { params: { workspaceId } }),
      403,
    );
    await expectStatus(
      await world.as("viewer").post("/api/analytics-report", {
        data: { workspaceId, name: "Viewer", config: { xAxis: "priority" } },
      }),
      403,
    );
    await expectStatus(
      await outsider.ctx.get("/api/analytics-report", {
        params: { workspaceId },
      }),
      403,
    );
    await expectStatus(
      await member.post("/api/analytics-report", {
        data: {
          workspaceId,
          name: "Elsewhere",
          config: {
            xAxis: "priority",
            scope: { projectIds: ["e2e-unknown-project"] },
          },
        },
      }),
      404,
    );
    await expectStatus(
      await member.post("/api/analytics-report", {
        data: { workspaceId, name: "", config: { xAxis: "priority" } },
      }),
      400,
    );
    await expectStatus(
      await member.post("/api/analytics-report", {
        data: { workspaceId, name: "Bad axis", config: { xAxis: "colour" } },
      }),
      400,
    );

    // A shared report: the admin (workspace:manage_settings) may delete it,
    // a member who doesn't own it may not.
    const shared = await expectJson<Report>(
      await world.as("owner").post("/api/analytics-report", {
        data: {
          workspaceId,
          name: "Shared board",
          visibility: "workspace",
          config: { xAxis: "priority" },
        },
      }),
    );
    expect(
      await expectJson<Report>(
        await member.get(`/api/analytics-report/${shared.id}`),
      ),
    ).toMatchObject({ isOwner: false, canDelete: false });
    await expectStatus(
      await member.delete(`/api/analytics-report/${shared.id}`),
      403,
    );
    await expectStatus(
      await world
        .as("owner")
        .patch(`/api/analytics-report/${shared.id}`, { data: {} }),
      400,
    );
    await expectJson(
      await world.as("admin").delete(`/api/analytics-report/${shared.id}`),
    );
    await expectStatus(
      await world.as("owner").get(`/api/analytics-report/${shared.id}`),
      404,
    );
  });
});

test(
  "similar open tasks for a title being typed",
  covers("findSimilarTasks"),
  async () => {
    const owner = world.as("owner");
    const word = `Quasar${Math.random().toString(36).slice(2, 7)}`;
    const open = await createTask(owner, project.id, {
      title: `${word} coupon rounding error`,
    });
    const done = await createTask(owner, project.id, {
      title: `${word} coupon rounding mismatch`,
      status: "done",
    });
    const path = `/api/task/similar/${project.id}`;

    const viewer = world.as("viewer");
    const similar = await eventually(
      async () => {
        const body = await expectJson<{
          tasks: { id: string; key: string; title: string; status: string }[];
        }>(
          await viewer.get(path, { params: { q: `${word} coupon rounding` } }),
        );
        return body.tasks.length > 0 ? body : null;
      },
      { what: "similar tasks" },
    );
    expect(similar.tasks.map((task) => task.id)).toEqual([open.id]);
    expect(similar.tasks[0]).toMatchObject({
      title: open.title,
      status: "to-do",
    });
    expect(similar.tasks[0]?.key).toMatch(/^[A-Z0-9]+-\d+$/);
    expect(similar.tasks.map((task) => task.id)).not.toContain(done.id);

    // Fewer than two significant words: no hints.
    const short = await expectJson<{ tasks: unknown[] }>(
      await viewer.get(path, { params: { q: "fix the" } }),
    );
    expect(short.tasks).toEqual([]);
    await expectStatus(await viewer.get(path, { params: { q: "  " } }), 400);
    await expectStatus(await viewer.get(path), 400);
    await expectStatus(
      await world
        .as("anonymous")
        .get(path, { params: { q: "coupon rounding" } }),
      401,
    );
    await expectStatus(
      await outsider.ctx.get(path, { params: { q: "coupon rounding" } }),
      403,
    );
  },
);
