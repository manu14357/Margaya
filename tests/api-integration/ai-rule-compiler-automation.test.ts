import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { forgetAutomationRules } from "../../apps/api/src/automation-rule/engine";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { automationScene } from "./helpers/automations";
import { resetTestDatabase } from "./helpers/database";

// The rule compiler's third target: "When → If → Then" automation rules.
// "When a bug moves to In review, assign Priya and add the needs-qa label"
// now compiles, is checked against the project, and replays over history.

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  forgetAutomationRules();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
});

function lastText(request: ChatRequest): string {
  const last = request.messages.at(-1);
  if (!last) return "";
  return typeof last.content === "string"
    ? last.content
    : last.content.map((block) => ("text" in block ? block.text : "")).join("");
}

async function scene() {
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
  const review = columns.find((column) => column.slug === "in-review");
  if (!review) throw new Error("no review column");
  return { ...s, review };
}

const reviewerRule = (reviewId: string, userId: string) => ({
  engine: "automation_rule",
  rule: {
    name: "Bugs in review go to Priya",
    trigger: { type: "status_changed", to: [reviewId] },
    conditions: {
      op: "and",
      conditions: [{ field: "labels", op: "contains", labels: ["bug"] }],
    },
    actions: [
      { type: "assign", userIds: [userId] },
      { type: "add_label", label: "needs-qa" },
    ],
  },
});

describe("API integration: rule compiler automation target", () => {
  it("compiles the reviewer example into an automation rule", async () => {
    const s = await scene();
    let prompt = "";
    setFakeResponder((request) => {
      prompt = lastText(request);
      return {
        text: JSON.stringify({
          rules: [
            reviewerRule(s.review.id, s.mia.id),
            // Someone outside the workspace can't be assigned: rejected.
            reviewerRule(s.review.id, s.outsider.id),
          ],
          unsupported: [],
        }),
      };
    });
    const response = await s.as(s.ada)("POST", "/ai/rules/compile", {
      projectId: s.web.project.id,
      prompt:
        "When a bug moves to In review, assign Mia and add the needs-qa label",
      locale: "en-US",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      status: string;
      rules: unknown[];
      rejected: number;
    };
    // One proposed rule was dropped, so the result is partial.
    expect(body.status).toBe("partial");
    expect(body.rules).toEqual([reviewerRule(s.review.id, s.mia.id)]);
    expect(body.rejected).toBe(1);
    // The model saw the people it may assign, wrapped as data.
    expect(prompt).toContain(`${s.mia.id}: Mia`);
    expect(prompt).toContain("<untrusted");

    // The compiled rule saves through the engine's own route.
    const saved = await s.as(s.ada)(
      "POST",
      `/automation-rule/${s.web.project.id}`,
      (body.rules[0] as { rule: unknown }).rule,
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
  });

  it("replays an automation rule over the project's history", async () => {
    const s = await scene();
    const bug = await s.createTask({ status: "to-do", updatedAt: new Date() });
    const other = await s.createTask({
      status: "to-do",
      updatedAt: new Date(),
    });
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#f00",
      taskId: bug.id,
      workspaceId: s.workspaceId,
    });
    for (const task of [bug, other]) {
      await s.ok(s.owner, "PUT", `/task/status/${task.id}`, {
        status: "in-review",
      });
    }
    // History rows are written by event subscribers; wait for both.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await db
        .select({ id: schema.activityTable.id })
        .from(schema.activityTable)
        .where(eq(schema.activityTable.type, "status_changed"));
      if (rows.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const response = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: reviewerRule(s.review.id, s.mia.id),
      days: 7,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      engine: string;
      notes: string[];
      matches: { taskId: string; outcome: string; kind: string; to: string }[];
    };
    expect(body.engine).toBe("automation_rule");
    expect(body.notes).toEqual(["conditions_current_state"]);
    const outcome = new Map(body.matches.map((match) => [match.taskId, match]));
    expect(outcome.get(bug.id)).toMatchObject({
      outcome: "change",
      kind: "automation",
      to: "In Review",
    });
    expect(outcome.get(other.id)?.outcome).toBe("skipped");

    // A rule that names a person outside the workspace is refused.
    const bad = await s.as(s.ada)("POST", "/ai/rules/dry-run", {
      projectId: s.web.project.id,
      rule: reviewerRule(s.review.id, s.outsider.id),
    });
    expect(bad.status).toBe(400);
  });
});
