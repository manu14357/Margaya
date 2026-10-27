import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createProject,
  createTask,
  createWorld,
  deleteApiKey,
  expectJson,
  expectStatus,
  headerContext,
  type Project,
  signUpUser,
  type Task,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// AI routes on an instance where AI is off (no provider configured): the
// availability, settings, usage and triage-settings reads and writes still
// work; every generation route answers 403 AI_DISABLED before it reads the
// body; the rule dry run is computed and works regardless. Settings are only
// changed in this file's own workspace and are restored before it ends.

type Availability = {
  available: boolean;
  instanceEnabled: boolean;
  configured: boolean;
  workspaceEnabled: boolean;
  projectEnabled: boolean | null;
  canUse: boolean;
  canManage: boolean;
  destination: string | null;
  provider: string | null;
  zeroRetention: boolean;
  requireApprovalForWrites: boolean;
  autoTranslateComments: boolean;
};

type WorkspaceAi = {
  enabled: boolean;
  provider: string | null;
  hasKey: boolean;
  keyLast4: string | null;
  keyUnreadable: boolean;
  monthlyCapMicros: number | null;
  userDailyCapTokens: number | null;
  requireApprovalForWrites: boolean;
  includeRestricted: boolean;
  localOnly: boolean;
  redactPii: boolean;
  autoTranslateComments: boolean;
  embeddingsEnabled: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

type Settings = {
  instance: {
    enabled: boolean;
    configured: boolean;
    provider: string;
    localAvailable: boolean;
    localOnly: boolean;
    allowWorkspaceKeys: boolean;
  };
  workspace: WorkspaceAi;
  semantic: {
    vectorStore: string;
    endpointConfigured: boolean;
    indexedItems: number;
    paused: string | null;
  };
  monthSpendMicros: number;
};

type TestResult = {
  ok: boolean;
  code: string | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  destination: string | null;
  latencyMs: number | null;
};

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
};

type Usage = {
  from: string;
  to: string;
  totals: Totals;
  byFeature: unknown[];
  byModel: unknown[];
  byUser: unknown[];
  byDay: unknown[];
};

const ZERO: Totals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicros: 0,
};
const VECTOR_STORE = ["unknown", "available", "unavailable", "ready"];

let world: World;
let outsider: TestUser;
let project: Project;
let task: Task;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("AI off");
  outsider = await signUpUser("AI outsider");
  project = await createProject(world.as("owner"), world.workspace.id);
  task = await createTask(world.as("owner"), project.id);
});

test.afterAll(async () => {
  // Leave the workspace's AI off whatever happened above.
  await world
    ?.as("owner")
    .patch("/api/ai/settings", {
      data: {
        workspaceId: world.workspace.id,
        enabled: false,
        monthlyCapMicros: null,
        userDailyCapTokens: null,
        requireApprovalForWrites: false,
        redactPii: false,
        autoTranslateComments: false,
      },
    })
    .catch(() => undefined);
  await world
    ?.as("owner")
    .patch(`/api/ai/triage/settings/${project?.id}`, {
      data: { autoApplyLabels: false },
    })
    .catch(() => undefined);
  await outsider?.ctx.dispose();
  await world?.dispose();
});

const MISSING = "ai-off-missing-id";

/** The workspace-scoped query every settings and usage read takes. */
const ws = () => ({ workspaceId: world.workspace.id });

async function availability(
  ctx: APIRequestContext,
  projectId?: string,
): Promise<Availability> {
  return expectJson<Availability>(
    await ctx.get("/api/ai/availability", {
      params: projectId ? { ...ws(), projectId } : ws(),
    }),
  );
}

test(
  "availability and settings read as off, per role",
  covers("getAiAvailability", "getAiSettings"),
  async () => {
    const owner = await availability(world.as("owner"));
    expect(owner).toMatchObject({
      available: false,
      instanceEnabled: false,
      configured: false,
      workspaceEnabled: false,
      projectEnabled: null,
      canUse: true,
      canManage: true,
      destination: null,
      provider: null,
      requireApprovalForWrites: false,
      autoTranslateComments: false,
    });

    // The project switch is on by default; AI stays unavailable.
    const inProject = await availability(world.as("member"), project.id);
    expect(inProject).toMatchObject({
      available: false,
      projectEnabled: true,
      canUse: true,
      canManage: false,
    });
    // An unknown project answers like a missing one: off.
    expect(
      (await availability(world.as("member"), MISSING)).projectEnabled,
    ).toBe(false);
    expect(await availability(world.as("viewer"))).toMatchObject({
      available: false,
      canUse: false,
      canManage: false,
    });
    await expectStatus(
      await outsider.ctx.get("/api/ai/availability", { params: ws() }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").get("/api/ai/availability", { params: ws() }),
      401,
    );

    const settings = await expectJson<Settings>(
      await world.as("admin").get("/api/ai/settings", { params: ws() }),
    );
    expect(settings.instance).toMatchObject({
      enabled: false,
      configured: false,
      localAvailable: false,
    });
    expect(settings.workspace).toMatchObject({
      enabled: false,
      provider: null,
      hasKey: false,
      keyLast4: null,
      keyUnreadable: false,
      monthlyCapMicros: null,
      userDailyCapTokens: null,
      localOnly: false,
      embeddingsEnabled: false,
      updatedAt: null,
      updatedBy: null,
    });
    expect(settings.monthSpendMicros).toBe(0);
    expect(VECTOR_STORE).toContain(settings.semantic.vectorStore);
    expect(settings.semantic.endpointConfigured).toBe(false);
    // The own key is write-only: no secret field ever comes back.
    expect(JSON.stringify(settings)).not.toMatch(/apiKey|secret/i);

    for (const role of ["member", "viewer"] as const) {
      await expectStatus(
        await world.as(role).get("/api/ai/settings", { params: ws() }),
        403,
      );
    }
    await expectStatus(
      await outsider.ctx.get("/api/ai/settings", { params: ws() }),
      403,
    );
    await expectStatus(
      await world.as("anonymous").get("/api/ai/settings", { params: ws() }),
      401,
    );
  },
);

test(
  "settings: opt in with caps, refused options, and back to off",
  covers("updateAiSettings"),
  async () => {
    const admin = world.as("admin");
    const on = await expectJson<Settings>(
      await admin.patch("/api/ai/settings", {
        data: {
          ...ws(),
          enabled: true,
          monthlyCapMicros: 5_000_000,
          userDailyCapTokens: 20_000,
          requireApprovalForWrites: true,
          redactPii: true,
          autoTranslateComments: true,
        },
      }),
    );
    expect(on.workspace).toMatchObject({
      enabled: true,
      monthlyCapMicros: 5_000_000,
      userDailyCapTokens: 20_000,
      requireApprovalForWrites: true,
      redactPii: true,
      autoTranslateComments: true,
      updatedBy: { id: world.users.admin.id },
    });
    expect(on.workspace.updatedAt).not.toBeNull();

    const read = await expectJson<Settings>(
      await world.as("owner").get("/api/ai/settings", { params: ws() }),
    );
    expect(read.workspace).toMatchObject(on.workspace);

    // The workspace is in, but the instance still keeps AI hidden.
    expect(await availability(world.as("member"))).toMatchObject({
      available: false,
      instanceEnabled: false,
      workspaceEnabled: true,
      requireApprovalForWrites: true,
      autoTranslateComments: true,
    });

    // Without a local model or an embeddings endpoint these are refused.
    for (const patch of [{ localOnly: true }, { embeddingsEnabled: true }]) {
      await expectStatus(
        await admin.patch("/api/ai/settings", { data: { ...ws(), ...patch } }),
        409,
      );
    }
    if (!read.instance.allowWorkspaceKeys) {
      await expectStatus(
        await admin.patch("/api/ai/settings", {
          data: {
            ...ws(),
            key: { provider: "anthropic", apiKey: "sk-e2e-never-stored" },
          },
        }),
        409,
      );
    }
    for (const data of [
      { ...ws(), monthlyCapMicros: -1 },
      { ...ws(), userDailyCapTokens: 1.5 },
      { ...ws(), unknownField: true },
    ]) {
      await expectStatus(await admin.patch("/api/ai/settings", { data }), 400);
    }
    for (const ctx of [world.as("member"), world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.patch("/api/ai/settings", {
          data: { ...ws(), enabled: false },
        }),
        403,
      );
    }
    await expectStatus(
      await world
        .as("anonymous")
        .patch("/api/ai/settings", { data: { ...ws(), enabled: false } }),
      401,
    );
    // Nothing above changed the saved settings.
    const unchanged = await expectJson<Settings>(
      await admin.get("/api/ai/settings", { params: ws() }),
    );
    expect(unchanged.workspace).toMatchObject({
      enabled: true,
      localOnly: false,
      embeddingsEnabled: false,
      hasKey: false,
      monthlyCapMicros: 5_000_000,
    });

    const off = await expectJson<Settings>(
      await admin.patch("/api/ai/settings", {
        data: {
          ...ws(),
          enabled: false,
          monthlyCapMicros: null,
          userDailyCapTokens: null,
          requireApprovalForWrites: false,
          redactPii: false,
          autoTranslateComments: false,
        },
      }),
    );
    expect(off.workspace).toMatchObject({
      enabled: false,
      monthlyCapMicros: null,
      userDailyCapTokens: null,
      requireApprovalForWrites: false,
      redactPii: false,
      autoTranslateComments: false,
    });
    expect((await availability(world.as("member"))).workspaceEnabled).toBe(
      false,
    );
  },
);

test(
  "the connection test reports the missing provider; usage is an empty ledger",
  covers("testAiConnection", "getAiUsage"),
  async () => {
    const owner = world.as("owner");
    const result = await expectJson<TestResult>(
      await owner.post("/api/ai/settings/test", { data: ws() }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "AI_NOT_CONFIGURED",
      latencyMs: null,
    });
    expect(result.message).toBeTruthy();
    for (const ctx of [world.as("member"), outsider.ctx]) {
      await expectStatus(
        await ctx.post("/api/ai/settings/test", { data: ws() }),
        403,
      );
    }

    const usage = await expectJson<Usage>(
      await owner.get("/api/ai/usage", {
        params: { ...ws(), from: "2030-01-01", to: "2030-01-31" },
      }),
    );
    expect(usage).toEqual({
      from: "2030-01-01T00:00:00.000Z",
      to: "2030-02-01T00:00:00.000Z",
      totals: ZERO,
      byFeature: [],
      byModel: [],
      byUser: [],
      byDay: [],
    });
    // The failed test above was refused before any call: nothing is billed.
    const month = await expectJson<Usage>(
      await world.as("admin").get("/api/ai/usage", { params: ws() }),
    );
    expect(month.totals).toEqual(ZERO);
    expect(Date.parse(month.from)).toBeLessThan(Date.parse(month.to));

    for (const range of [
      { from: "2030-02-01", to: "2030-01-01" } as Record<string, string>,
      { from: "2028-01-01", to: "2030-01-01" },
      { from: "2030-01-1" },
    ]) {
      await expectStatus(
        await owner.get("/api/ai/usage", { params: { ...ws(), ...range } }),
        400,
      );
    }
    for (const role of ["member", "viewer"] as const) {
      await expectStatus(
        await world.as(role).get("/api/ai/usage", { params: ws() }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").get("/api/ai/usage", { params: ws() }),
      401,
    );
  },
);

test(
  "instance AI status, test and usage are for instance admins with a session",
  covers(
    "getInstanceAiStatus",
    "testInstanceAiConnection",
    "getInstanceAiUsage",
  ),
  async ({ api }) => {
    const status = await expectJson<{
      enabled: boolean;
      configured: boolean;
      fakeAllowed: boolean;
      provider: string;
      models: Record<"fast" | "balanced" | "deep", string>;
      localAvailable: boolean;
      embeddingsConfigured: boolean;
      vectorStore: string;
    }>(await api.get("/api/ai/instance/status"));
    expect(status).toMatchObject({
      enabled: false,
      configured: false,
      localAvailable: false,
      embeddingsConfigured: false,
    });
    expect(["anthropic", "openai_compatible", "fake"]).toContain(
      status.provider,
    );
    expect(Object.keys(status.models).sort()).toEqual([
      "balanced",
      "deep",
      "fast",
    ]);
    expect(VECTOR_STORE).toContain(status.vectorStore);
    expect(JSON.stringify(status)).not.toMatch(/apiKey|secret/i);

    const cloud = await expectJson<TestResult>(
      await api.post("/api/ai/instance/test", { data: {} }),
    );
    expect(cloud).toMatchObject({ ok: false, code: "AI_NOT_CONFIGURED" });
    const local = await expectJson<TestResult>(
      await api.post("/api/ai/instance/test", { data: { target: "local" } }),
    );
    expect(local).toMatchObject({
      ok: false,
      code: "AI_NOT_CONFIGURED",
      message: "No local model is set up",
      destination: null,
      latencyMs: null,
    });
    await expectStatus(
      await api.post("/api/ai/instance/test", { data: { target: "moon" } }),
      400,
    );

    const usage = await expectJson<{
      from: string;
      to: string;
      totals: Totals;
      byWorkspace: unknown[];
      byModel: unknown[];
      byDay: unknown[];
    }>(
      await api.get("/api/ai/instance/usage", {
        params: { from: "2030-03-01", to: "2030-03-02" },
      }),
    );
    expect(usage).toEqual({
      from: "2030-03-01T00:00:00.000Z",
      to: "2030-03-03T00:00:00.000Z",
      totals: ZERO,
      byWorkspace: [],
      byModel: [],
      byDay: [],
    });
    await expectStatus(
      await api.get("/api/ai/instance/usage", {
        params: { from: "2030-03-02", to: "2030-03-01" },
      }),
      400,
    );

    // A workspace owner is not an instance admin.
    const workspaceOwner = world.as("owner");
    await expectStatus(
      await workspaceOwner.get("/api/ai/instance/status"),
      403,
    );
    await expectStatus(
      await workspaceOwner.post("/api/ai/instance/test", { data: {} }),
      403,
    );
    await expectStatus(await workspaceOwner.get("/api/ai/instance/usage"), 403);
    await expectStatus(
      await world.as("anonymous").get("/api/ai/instance/status"),
      401,
    );

    // The instance admin's own API key is refused: a session is required.
    const key = await createApiKey(api);
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(
        await viaKey.get("/api/ai/instance/status"),
        [401, 403],
      );
      await expectStatus(
        await viaKey.get("/api/ai/instance/usage"),
        [401, 403],
      );
    } finally {
      await viaKey.dispose();
      await deleteApiKey(api, key.id);
    }
  },
);

test(
  "every generation route answers AI_DISABLED, after access and ai:use",
  covers(
    "aiAsk",
    "aiDuplicateCheck",
    "aiBuildProposal",
    "aiBuildApply",
    "aiEditorAssist",
    "aiSummarize",
    "aiSpecDraft",
    "aiTriageSuggest",
    "aiCompileRule",
    "aiTranslate",
    "aiGenerateBrief",
    "aiExplainEstimate",
    "aiRetroNarrative",
    "aiMyBriefSummary",
    "aiCaptureAnalyze",
  ),
  async () => {
    const workspaceId = world.workspace.id;
    const newProjectName = uniqueName("AI built project");
    const calls: {
      path: string;
      data: Record<string, unknown>;
      /** Who has every permission the route checks before the AI switch. */
      actor?: "admin";
    }[] = [
      { path: "/api/ai/ask", data: { workspaceId, question: "What is due?" } },
      {
        path: "/api/ai/build/duplicates",
        data: { projectId: project.id, title: "Login page is blank" },
      },
      {
        path: "/api/ai/build/proposal",
        data: { workspaceId, prompt: "Plan a website relaunch in 3 sprints" },
      },
      {
        path: "/api/ai/build/apply",
        data: {
          workspaceId,
          proposal: {
            summary: "A small plan",
            project: { name: newProjectName, key: "AIB", description: "" },
            columns: [],
            labels: [],
            cycles: [],
            modules: [],
            tasks: [],
          },
        },
      },
      {
        path: "/api/ai/writing/assist",
        data: {
          workspaceId,
          target: { kind: "task", id: task.id },
          action: "improve",
          text: "make this better",
        },
      },
      {
        path: "/api/ai/writing/summarize",
        data: { workspaceId, kind: "project", id: project.id },
      },
      {
        path: "/api/ai/writing/spec-draft",
        data: { workspaceId, taskId: task.id },
      },
      { path: "/api/ai/triage/suggest", data: { taskId: task.id } },
      {
        path: "/api/ai/rules/compile",
        actor: "admin",
        data: {
          projectId: project.id,
          prompt: "When a task is created, set it to urgent",
        },
      },
      {
        path: "/api/ai/translate",
        data: { workspaceId, kind: "task", id: task.id, targetLocale: "de-DE" },
      },
      {
        path: "/api/ai/brief",
        data: { workspaceId, scopeType: "project", scopeId: project.id },
      },
      {
        path: "/api/ai/insight/estimate",
        data: { workspaceId, projectId: project.id, taskId: task.id },
      },
      {
        path: "/api/ai/insight/retro",
        data: { workspaceId, cycleId: MISSING },
      },
      { path: "/api/ai/insight/my-brief", data: { workspaceId } },
      {
        path: `/api/ai/capture/${project.id}`,
        data: { source: "transcript", text: "Alex will fix the login bug." },
      },
    ];

    for (const { path, data, actor = "member" } of calls) {
      // The caller has ai:use and the route's permissions: the AI switch is
      // the answer.
      const text = await expectStatus(
        await world.as(actor).post(path, { data }),
        403,
      );
      expect(text, path).toContain("AI_DISABLED");
      const body = JSON.parse(text);
      expect(body, path).toEqual({
        code: "AI_DISABLED",
        message: "AI is turned off on this server",
      });
      await expectStatus(await outsider.ctx.post(path, { data }), 403);
      await expectStatus(await world.as("anonymous").post(path, { data }), 401);
    }

    // Compiling a rule also needs project:update, checked before the switch.
    expect(
      await expectStatus(
        await world.as("member").post("/api/ai/rules/compile", {
          data: { projectId: project.id, prompt: "Archive old tasks" },
        }),
        403,
      ),
    ).not.toContain("AI_DISABLED");

    // A viewer lacks ai:use: refused before the AI switch is consulted.
    for (const path of ["/api/ai/ask", "/api/ai/insight/my-brief"]) {
      const text = await expectStatus(
        await world.as("viewer").post(path, {
          data: { workspaceId, question: "Anything?" },
        }),
        403,
      );
      expect(text, path).not.toContain("AI_DISABLED");
    }

    // The refused apply created nothing.
    const projects = await expectJson<{ name: string }[]>(
      await world.as("owner").get("/api/project", { params: { workspaceId } }),
    );
    expect(projects.map((entry) => entry.name)).not.toContain(newProjectName);
  },
);

test(
  "sharing a brief needs an existing brief",
  covers("aiShareBrief"),
  async () => {
    // No brief can be generated while AI is off, so only the guards run.
    expect(
      await expectStatus(
        await world
          .as("member")
          .post(`/api/ai/brief/${MISSING}/share`, { data: {} }),
        404,
      ),
    ).toContain("Brief not found");
    await expectStatus(
      await world
        .as("anonymous")
        .post(`/api/ai/brief/${MISSING}/share`, { data: {} }),
      401,
    );
  },
);

test(
  "triage settings: read by any member, auto-apply toggled by project:update",
  covers("getAiTriageSettings", "updateAiTriageSettings"),
  async () => {
    const path = `/api/ai/triage/settings/${project.id}`;
    expect(await expectJson(await world.as("viewer").get(path))).toEqual({
      projectId: project.id,
      autoApplyLabels: false,
    });

    expect(
      await expectJson(
        await world
          .as("admin")
          .patch(path, { data: { autoApplyLabels: true } }),
      ),
    ).toEqual({ projectId: project.id, autoApplyLabels: true });
    expect(await expectJson(await world.as("member").get(path))).toEqual({
      projectId: project.id,
      autoApplyLabels: true,
    });

    for (const role of ["member", "viewer"] as const) {
      await expectStatus(
        await world.as(role).patch(path, { data: { autoApplyLabels: false } }),
        403,
      );
    }
    for (const data of [{ autoApplyLabels: "yes" }, {}]) {
      await expectStatus(await world.as("admin").patch(path, { data }), 400);
    }
    await expectStatus(await outsider.ctx.get(path), 403);
    await expectStatus(await world.as("anonymous").get(path), 401);

    const missing = `/api/ai/triage/settings/${MISSING}`;
    expect(
      await expectStatus(await world.as("owner").get(missing), 404),
    ).toContain("Project not found");
    expect(
      await expectStatus(
        await world
          .as("owner")
          .patch(missing, { data: { autoApplyLabels: true } }),
        404,
      ),
    ).toContain("Project not found");

    expect(
      await expectJson(
        await world
          .as("owner")
          .patch(path, { data: { autoApplyLabels: false } }),
      ),
    ).toEqual({ projectId: project.id, autoApplyLabels: false });
    expect(
      (
        await expectJson<{ autoApplyLabels: boolean }>(
          await world.as("viewer").get(path),
        )
      ).autoApplyLabels,
    ).toBe(false);
  },
);

test(
  "the rule dry run replays history without a model while AI is off",
  covers("aiRuleDryRun"),
  async () => {
    const rule = {
      engine: "automation_rule",
      rule: {
        name: "Urgent on create",
        trigger: { type: "task_created" },
        actions: [{ type: "set_priority", priority: "urgent" }],
      },
    };
    const result = await expectJson<{
      projectId: string;
      projectSlug: string;
      engine: string;
      days: number;
      from: string;
      to: string;
      total: number;
      changed: number;
      capped: boolean;
      matches: { taskId: string; kind: string; outcome: string }[];
      notes: string[];
    }>(
      await world.as("admin").post("/api/ai/rules/dry-run", {
        data: { projectId: project.id, rule, days: 7 },
      }),
    );
    expect(result).toMatchObject({
      projectId: project.id,
      projectSlug: project.slug,
      engine: "automation_rule",
      days: 7,
      total: 1,
      changed: 1,
      capped: false,
      notes: ["conditions_current_state"],
    });
    expect(result.matches).toEqual([
      expect.objectContaining({
        taskId: task.id,
        kind: "automation",
        outcome: "change",
      }),
    ]);
    expect(Date.parse(result.to) - Date.parse(result.from)).toBe(
      7 * 86_400_000,
    );

    // Conditions the task does not meet skip it.
    const skipped = await expectJson<{ changed: number; matches: unknown[] }>(
      await world.as("owner").post("/api/ai/rules/dry-run", {
        data: {
          projectId: project.id,
          rule: {
            ...rule,
            rule: {
              ...rule.rule,
              conditions: {
                op: "and",
                conditions: [
                  { field: "priority", op: "is", values: ["urgent"] },
                ],
              },
            },
          },
        },
      }),
    );
    expect(skipped.changed).toBe(0);
    expect(skipped.matches).toEqual([
      expect.objectContaining({ taskId: task.id, outcome: "skipped" }),
    ]);

    for (const data of [
      { projectId: project.id, rule, days: 0 },
      { projectId: project.id, rule: { engine: "magic" } },
      {
        projectId: project.id,
        rule: {
          ...rule,
          rule: {
            ...rule.rule,
            actions: [{ type: "set_status", columnId: MISSING }],
          },
        },
      },
    ]) {
      await expectStatus(
        await world.as("admin").post("/api/ai/rules/dry-run", { data }),
        400,
      );
    }
    for (const ctx of [world.as("member"), world.as("viewer"), outsider.ctx]) {
      await expectStatus(
        await ctx.post("/api/ai/rules/dry-run", {
          data: { projectId: project.id, rule },
        }),
        403,
      );
    }
    await expectStatus(
      await world.as("anonymous").post("/api/ai/rules/dry-run", {
        data: { projectId: project.id, rule },
      }),
      401,
    );
  },
);

test(
  "AI routes keyed by a project answer 404 for an unknown one",
  covers(
    "aiRuleDryRun",
    "aiDuplicateCheck",
    "aiCompileRule",
    "aiCaptureAnalyze",
  ),
  async () => {
    // Each documents 404 "Project not found" for an unknown project.
    const owner = world.as("owner");
    const requests = [
      owner.post("/api/ai/rules/dry-run", {
        data: {
          projectId: MISSING,
          rule: {
            engine: "project_automation",
            patch: { cycleRollover: { enabled: true } },
          },
        },
      }),
      owner.post("/api/ai/build/duplicates", {
        data: { projectId: MISSING, title: "Login page is blank" },
      }),
      owner.post("/api/ai/rules/compile", {
        data: { projectId: MISSING, prompt: "Archive old tasks" },
      }),
      owner.post(`/api/ai/capture/${MISSING}`, {
        data: { source: "transcript", text: "Fix the login bug." },
      }),
    ];
    const answers: string[] = [];
    for (const request of requests) {
      const response = await request;
      answers.push(
        `${new URL(response.url()).pathname} ${response.status()} ${await response.text()}`,
      );
    }
    for (const answer of answers) {
      expect.soft(answer).toMatch(/^\S+ 404 .*Project not found/);
    }
  },
);
