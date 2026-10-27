import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import db, { schema } from "../../apps/api/src/database";
import { aiUsageTable } from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { automationScene, monthsAgo } from "./helpers/automations";
import { resetTestDatabase } from "./helpers/database";

// Rule compiler (C5) with the fake provider: compiled rules in the engines'
// exact schemas, validation, unsupported requests, the history dry run and
// the automation permission (project:update).

type Scene = Awaited<ReturnType<typeof aiRuleScene>>;

type Compiled = {
  projectId: string;
  status: "compiled" | "partial" | "unsupported";
  rules: Record<string, unknown>[];
  unsupported: { request: string; reason: string }[];
  rejected: number;
};

type DryRun = {
  engine: string;
  total: number;
  changed: number;
  capped: boolean;
  notes: string[];
  matches: {
    taskId: string;
    taskNumber: number | null;
    kind: string;
    outcome: string;
    from: string | null;
    to: string | null;
    at: string | null;
  }[];
};

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;
const DAY = 86_400_000;

let lastPrompt = "";

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  lastPrompt = "";
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
});

function userText(request: ChatRequest): string {
  const last = request.messages.at(-1);
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : last.content.map((block) => ("text" in block ? block.text : "")).join("");
}

/** The fake answers with JSON built from the prompt's column list. */
function scriptAnswer(build: (columnIds: Map<string, string>) => unknown) {
  setFakeResponder((request) => {
    const text = userText(request);
    lastPrompt = text;
    const ids = new Map<string, string>();
    for (const match of text.matchAll(/^(\S+): (.+) \(group: \w+\)$/gm)) {
      if (match[1] && match[2]) ids.set(match[2].toLowerCase(), match[1]);
    }
    return { text: JSON.stringify(build(ids)) };
  });
}

async function aiRuleScene() {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  const s = await automationScene();
  await s.ok(s.owner, "PATCH", "/ai/settings", {
    workspaceId: s.workspaceId,
    enabled: true,
  });
  const columns = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, s.web.project.id));
  const column = (slug: string) => {
    const found = columns.find((entry) => entry.slug === slug);
    if (!found) throw new Error(`no column ${slug}`);
    return found;
  };
  return { ...s, column };
}

function compile(s: Scene, user: Scene["ada"], prompt: string) {
  return s.as(user)("POST", "/ai/rules/compile", {
    projectId: s.web.project.id,
    prompt,
    locale: "en-US",
  });
}

describe("API integration: rule compiler", () => {
  it("compiles a request into a workflow rule in the engine's schema", async () => {
    const s = await aiRuleScene();
    scriptAnswer((ids) => ({
      rules: [
        {
          engine: "workflow_rule",
          rule: {
            integrationType: "github",
            eventType: "pr_merged",
            columnId: ids.get("done"),
          },
        },
      ],
      unsupported: [
        {
          request: "and notify Sam",
          reason: "Rules cannot send notifications.",
        },
      ],
    }));

    const response = await compile(
      s,
      s.ada,
      "When a GitHub pull request is merged, move the task to Done and notify Sam",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Compiled;
    expect(body.status).toBe("partial");
    expect(body.rejected).toBe(0);
    expect(body.rules).toEqual([
      {
        engine: "workflow_rule",
        rule: {
          integrationType: "github",
          eventType: "pr_merged",
          columnId: s.column("done").id,
        },
      },
    ]);
    expect(body.unsupported).toEqual([
      { request: "and notify Sam", reason: "Rules cannot send notifications." },
    ]);
    // Column names are data, the request is the person's own words.
    expect(lastPrompt).toContain("<untrusted");
    expect(lastPrompt).toContain("<request>");

    const usage = await db
      .select()
      .from(aiUsageTable)
      .where(
        and(
          eq(aiUsageTable.workspaceId, s.workspaceId),
          eq(aiUsageTable.feature, "rule_compiler"),
        ),
      );
    expect(usage).toHaveLength(1);
    expect(usage[0]?.tier).toBe("balanced");

    // Nothing was saved: saving goes through the engine's own route.
    const rules = await db
      .select()
      .from(schema.workflowRuleTable)
      .where(eq(schema.workflowRuleTable.projectId, s.web.project.id));
    expect(rules).toHaveLength(0);
    const rule = body.rules[0] as { rule: Record<string, string> };
    const saved = await s.as(s.ada)(
      "PUT",
      `/workflow-rule/${s.web.project.id}`,
      rule.rule,
    );
    expect(saved.status).toBe(200);
  });

  it("compiles project automation settings", async () => {
    const s = await aiRuleScene();
    scriptAnswer((ids) => ({
      rules: [
        {
          engine: "project_automation",
          patch: {
            autoClose: {
              enabled: true,
              months: 2,
              columnId: ids.get("won't do"),
            },
            cycleRollover: { enabled: true },
          },
        },
      ],
      unsupported: [],
    }));
    const response = await compile(
      s,
      s.ada,
      "Close tasks untouched for 2 months as Won't do and roll unfinished cycle work over",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Compiled;
    expect(body.status).toBe("compiled");
    expect(body.rules).toEqual([
      {
        engine: "project_automation",
        patch: {
          autoClose: { enabled: true, months: 2, columnId: s.wontDo.id },
          cycleRollover: { enabled: true },
        },
      },
    ]);
  });

  it("drops rules that fail the engines' validation", async () => {
    const s = await aiRuleScene();
    scriptAnswer((ids) => ({
      rules: [
        // An invented trigger and action.
        {
          engine: "workflow_rule",
          rule: {
            integrationType: "github",
            eventType: "status_changed",
            columnId: ids.get("in review"),
            assignee: "Priya",
          },
        },
        // Out of the engine's bounds.
        {
          engine: "project_automation",
          patch: { autoArchive: { months: 24 } },
        },
        // Auto-close into a column outside the Cancelled group.
        {
          engine: "project_automation",
          patch: { autoClose: { enabled: true, columnId: ids.get("done") } },
        },
        // Another project's column.
        {
          engine: "workflow_rule",
          rule: {
            integrationType: "gitea",
            eventType: "pr_opened",
            columnId: "not-a-column",
          },
        },
      ],
      unsupported: [],
    }));
    const response = await compile(s, s.ada, "Do clever things with tasks");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Compiled;
    expect(body.rules).toEqual([]);
    expect(body.rejected).toBe(4);
    expect(body.status).toBe("unsupported");
  });

  it("reports requests the engines can't express instead of inventing rules", async () => {
    const s = await aiRuleScene();
    scriptAnswer(() => ({
      rules: [],
      unsupported: [
        {
          request: "when a bug is moved to In review",
          reason:
            "Rules can't react to a person moving a task or check its labels.",
        },
        {
          request: "assign it to Priya and add the needs-qa label",
          reason: "Rules can only move tasks between columns.",
        },
      ],
    }));
    const response = await compile(
      s,
      s.ada,
      "When a bug is moved to In review, assign it to Priya and add the needs-qa label",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Compiled;
    expect(body.status).toBe("unsupported");
    expect(body.rules).toEqual([]);
    expect(body.unsupported).toHaveLength(2);
  });

  it("needs ai:use and the automation permission (project:update)", async () => {
    const s = await aiRuleScene();
    scriptAnswer(() => ({ rules: [], unsupported: [] }));
    // Mia (member) can use AI but can't manage automations; Vic can do neither.
    expect((await compile(s, s.mia, "Archive old work")).status).toBe(403);
    expect((await compile(s, s.vic, "Archive old work")).status).toBe(403);
    const outsider = await compile(s, s.outsider, "Archive old work");
    expect(outsider.status).toBe(403);

    const dryRun = (user: Scene["ada"]) =>
      s.as(user)("POST", "/ai/rules/dry-run", {
        projectId: s.web.project.id,
        rule: {
          engine: "project_automation",
          patch: { autoArchive: { enabled: true } },
        },
      });
    expect((await dryRun(s.mia)).status).toBe(403);
    expect((await dryRun(s.vic)).status).toBe(403);
    expect((await dryRun(s.ada)).status).toBe(200);
  });

  it("is off with AI off, while the dry run keeps working", async () => {
    const s = await aiRuleScene();
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    expect((await compile(s, s.ada, "Archive old work")).status).toBe(403);

    process.env.MARGAYA_AI_ENABLED = "false";
    const off = await compile(s, s.ada, "Archive old work");
    expect(off.status).toBe(403);
    expect(((await off.json()) as { code: string }).code).toBe("AI_DISABLED");

    const dryRun = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "project_automation",
        patch: { flowAlerts: { enabled: true } },
      },
    });
    expect(dryRun.status).toBe(200);
    expect(((await dryRun.json()) as DryRun).notes).toEqual([
      "flow_alerts_notify_only",
    ]);
  });
});

describe("API integration: rule dry run", () => {
  async function linkScene() {
    const s = await aiRuleScene();
    const [integration] = await db
      .insert(schema.integrationTable)
      .values({ projectId: s.web.project.id, type: "github", config: "{}" })
      .returning();
    if (!integration) throw new Error("no integration");
    const now = Date.now();
    const ago = (days: number) => new Date(now - days * DAY);

    const task = async (number: number, status: string) => {
      const [row] = await db
        .insert(schema.taskTable)
        .values({
          projectId: s.web.project.id,
          title: `Task ${number}`,
          number,
          status,
        })
        .returning();
      if (!row) throw new Error("no task");
      return row;
    };
    const link = async (
      taskId: string,
      resourceType: string,
      createdAt: Date,
      updatedAt: Date,
      metadata: Record<string, unknown>,
    ) => {
      await db.insert(schema.externalLinkTable).values({
        taskId,
        integrationId: integration.id,
        resourceType,
        externalId: `${taskId}-${resourceType}`,
        url: "https://example.test/pr",
        metadata: JSON.stringify(metadata),
        createdAt,
        updatedAt,
      });
    };
    const statusChange = async (
      taskId: string,
      at: Date,
      oldStatus: string,
      newStatus: string,
    ) => {
      await db.insert(schema.activityTable).values({
        taskId,
        type: "status_changed",
        createdAt: at,
        eventData: { oldStatus, newStatus },
      });
    };
    return { ...s, ago, task, link, statusChange };
  }

  it("replays integration events with each task's column at the time", async () => {
    const s = await linkScene();
    // 1: PR opened 5 days ago while in To Do, moved to Done later.
    const t1 = await s.task(1, "done");
    await s.link(t1.id, "pull_request", s.ago(5), s.ago(2), {
      state: "closed",
      merged: true,
      mergedAt: s.ago(2).toISOString(),
    });
    await s.statusChange(t1.id, s.ago(3), "to-do", "done");
    // 2: PR opened 4 days ago, the task already in review.
    const t2 = await s.task(2, "in-review");
    await s.link(t2.id, "pull_request", s.ago(4), s.ago(4), { state: "open" });
    // 3: PR opened while the task was Done (a final column): skipped.
    const t3 = await s.task(3, "done");
    await s.link(t3.id, "pull_request", s.ago(6), s.ago(6), { state: "open" });
    // 4: PR opened 40 days ago: outside a 30-day window.
    const t4 = await s.task(4, "to-do");
    await s.link(t4.id, "pull_request", s.ago(40), s.ago(40), {
      state: "open",
    });
    // 5: a branch, not a pull request.
    const t5 = await s.task(5, "to-do");
    await s.link(t5.id, "branch", s.ago(1), s.ago(1), {});

    const run = async (eventType: string, slug: string, days = 30) => {
      const response = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
        projectId: s.web.project.id,
        days,
        rule: {
          engine: "workflow_rule",
          rule: {
            integrationType: "github",
            eventType,
            columnId: s.column(slug).id,
          },
        },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as DryRun;
    };

    const opened = await run("pr_opened", "in-review");
    expect(opened.engine).toBe("workflow_rule");
    expect(
      opened.matches.map((m) => [m.taskNumber, m.outcome, m.from, m.to]),
    ).toEqual([
      [2, "unchanged", "In Review", "In Review"],
      [1, "change", "To Do", "In Review"],
      [3, "skipped", "Done", "In Review"],
    ]);
    expect(opened.total).toBe(3);
    expect(opened.changed).toBe(1);
    expect(opened.notes).toEqual([]);

    const merged = await run("pr_merged", "done");
    expect(merged.matches.map((m) => [m.taskNumber, m.outcome])).toEqual([
      [1, "unchanged"],
    ]);

    const wider = await run("pr_opened", "in-review", 60);
    expect(wider.total).toBe(4);

    const pushes = await run("branch_push", "in-progress");
    expect(pushes.matches.map((m) => [m.taskNumber, m.outcome])).toEqual([
      [5, "change"],
    ]);
    expect(pushes.notes).toContain("branch_push_last_only");

    const gitea = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "workflow_rule",
        rule: {
          integrationType: "gitea",
          eventType: "pr_opened",
          columnId: s.column("in-review").id,
        },
      },
    });
    const giteaBody = (await gitea.json()) as DryRun;
    expect(giteaBody.total).toBe(0);
    expect(giteaBody.notes).toContain("integration_not_connected");
  });

  it("replays auto-archive and auto-close from the tasks' last updates", async () => {
    const s = await aiRuleScene();
    const now = new Date();
    const old = await s.createTask({
      status: "done",
      updatedAt: monthsAgo(now, 4),
    });
    await s.createTask({ status: "done", updatedAt: new Date() });
    const stale = await s.createTask({
      status: "to-do",
      updatedAt: monthsAgo(now, 3),
    });

    const archive = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "project_automation",
        patch: { autoArchive: { enabled: true, months: 3 } },
      },
    });
    expect(archive.status).toBe(200);
    const archiveBody = (await archive.json()) as DryRun;
    expect(
      archiveBody.matches.map((m) => [m.taskId, m.kind, m.outcome]),
    ).toEqual([[old.id, "archive", "change"]]);
    expect(archiveBody.notes).toContain("threshold_from_last_update");

    const close = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "project_automation",
        patch: {
          autoClose: { enabled: true, months: 2, columnId: s.wontDo.id },
        },
      },
    });
    const closeBody = (await close.json()) as DryRun;
    expect(closeBody.matches.map((m) => [m.taskId, m.from, m.to])).toEqual([
      [stale.id, "To Do", "Won't do"],
    ]);

    // Nothing happened to the tasks.
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, old.id));
    expect(row?.archivedAt).toBeNull();

    // Turning things off has nothing to replay.
    const off = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "project_automation",
        patch: { autoArchive: { enabled: false } },
      },
    });
    expect(((await off.json()) as DryRun).notes).toEqual(["nothing_enabled"]);
  });

  it("rejects a rule that does not fit the project", async () => {
    const s = await aiRuleScene();
    const [apiColumn] = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, s.api.project.id));
    const foreign = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "workflow_rule",
        rule: {
          integrationType: "github",
          eventType: "pr_opened",
          columnId: apiColumn?.id,
        },
      },
    });
    expect(foreign.status).toBe(400);
    const invented = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: {
        engine: "workflow_rule",
        rule: {
          integrationType: "github",
          eventType: "label_added",
          columnId: s.column("done").id,
        },
      },
    });
    expect(invented.status).toBe(400);
  });
});
