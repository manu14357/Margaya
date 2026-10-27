import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import {
  forgetAutomationRules,
  settleAutomationRuns,
} from "../../apps/api/src/automation-rule/engine";
import {
  AUTOMATION_DUE_LEASE,
  AUTOMATION_RETENTION_LEASE,
  runAutomationDueDates,
  runAutomationRunRetention,
} from "../../apps/api/src/automation-rule/jobs";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import {
  automationRuleTable,
  automationRunTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { automationScene } from "./helpers/automations";
import { resetTestDatabase } from "./helpers/database";

// The "When → If → Then" engine through the real API: triggers fire from
// people's changes, actions go through the existing controllers as the
// system actor "Automation", loops stop, restricted projects hold, and the
// run log is kept for its retention.

type Rule = { id: string; enabled: boolean; runCount: number };
type Run = {
  ruleId: string;
  outcome: string;
  error: string | null;
  depth: number;
  actions: { type: string; status: string }[];
};

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  forgetAutomationRules();
});

afterEach(async () => {
  await settleAutomationRuns();
  await settleAuditWrites();
});

async function scene() {
  const s = await automationScene();
  const columns = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, s.web.project.id));
  const column = (slug: string) => {
    const found = columns.find((entry) => entry.slug === slug);
    if (!found) throw new Error(`no column ${slug}`);
    return found;
  };
  const projectId = s.web.project.id;
  const createRule = (body: Record<string, unknown>, user = s.ada) =>
    s.as(user)("POST", `/automation-rule/${projectId}`, body);
  const task = (values: Parameters<typeof s.createTask>[0] = {}) =>
    s.createTask({ status: "to-do", updatedAt: new Date(), ...values });
  const settle = async () => {
    // A run's actions publish events that queue the next rule.
    for (let round = 0; round < 6; round += 1) await settleAutomationRuns();
    await settleAuditWrites();
  };
  const runs = async () =>
    (
      await s.ok<{ runs: Run[] }>(
        s.ada,
        "GET",
        `/automation-rule/${projectId}/runs?limit=100`,
      )
    ).runs;
  return { ...s, column, projectId, createRule, task, settle, runs };
}

const reviewerRule = (
  s: Awaited<ReturnType<typeof scene>>,
  extra: Record<string, unknown> = {},
) => ({
  name: "Assign reviewer when moved to In review",
  trigger: { type: "status_changed", to: [s.column("in-review").id] },
  conditions: {
    op: "and",
    conditions: [{ field: "labels", op: "contains", labels: ["bug"] }],
  },
  actions: [
    { type: "assign", userIds: [s.mia.id] },
    { type: "add_label", label: "needs-qa" },
    { type: "add_comment", template: "Ready for QA: {{task.title}}" },
  ],
  ...extra,
});

describe("API integration: automation rules", () => {
  it("runs a rule when a person moves a task, as Automation", async () => {
    const s = await scene();
    const created = await s.createRule(reviewerRule(s));
    expect(created.status, await created.clone().text()).toBe(200);
    const rule = (await created.json()) as Rule;

    const bug = await s.task({ title: "Crash on save" });
    await db.insert(schema.labelTable).values({
      name: "bug",
      color: "#ff0000",
      taskId: bug.id,
      workspaceId: s.workspaceId,
    });
    const plain = await s.task({ title: "Polish" });

    for (const target of [bug, plain]) {
      const moved = await s.as(s.owner)("PUT", `/task/status/${target.id}`, {
        status: "in-review",
      });
      expect(moved.status).toBe(200);
    }
    await s.settle();

    const assignees = await db
      .select()
      .from(schema.taskAssigneeTable)
      .where(eq(schema.taskAssigneeTable.taskId, bug.id));
    expect(assignees.map((row) => row.userId)).toEqual([s.mia.id]);
    const labels = await db
      .select({ name: schema.labelTable.name })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, bug.id));
    expect(labels.map((row) => row.name).sort()).toEqual(["bug", "needs-qa"]);

    const comments = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, bug.id),
          eq(schema.activityTable.type, "comment"),
        ),
      );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.userId).toBeNull();
    expect(comments[0]?.content).toBe("Ready for QA: Crash on save");
    expect(comments[0]?.eventData).toMatchObject({
      automation: { rule: "custom", ruleId: rule.id },
    });

    // History rows of the actions name the automation, not the mover.
    const history = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, bug.id),
          eq(schema.activityTable.type, "label_added"),
        ),
      );
    expect(history.some((row) => row.userId === null)).toBe(true);

    // The plain task did not meet the condition: nothing ran or was logged.
    const plainAssignees = await db
      .select()
      .from(schema.taskAssigneeTable)
      .where(eq(schema.taskAssigneeTable.taskId, plain.id));
    expect(plainAssignees).toHaveLength(0);

    const runs = await s.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      ruleId: rule.id,
      outcome: "success",
      depth: 0,
    });
    expect(runs[0]?.actions.map((action) => action.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "automation.rule_ran"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: "automation",
      actorUserId: null,
      actorName: "Automation",
      targetId: bug.id,
    });
    expect(audit[0]?.metadata).toMatchObject({ ruleId: rule.id });

    const [counters] = await db
      .select()
      .from(automationRuleTable)
      .where(eq(automationRuleTable.id, rule.id));
    expect(counters).toMatchObject({ runCount: 1, lastOutcome: "success" });
  });

  it("fires from labels, priority, comments and creation", async () => {
    const s = await scene();
    const rules = [
      {
        name: "Urgent bugs",
        trigger: { type: "label_added", labels: ["bug"] },
        actions: [{ type: "set_priority", priority: "urgent" }],
      },
      {
        name: "Urgent work is due soon",
        trigger: { type: "priority_changed", to: ["urgent"] },
        actions: [{ type: "set_due_date", offsetDays: 2 }],
      },
      {
        name: "Comments start work",
        trigger: { type: "comment_added" },
        conditions: {
          op: "and",
          conditions: [
            { field: "status", op: "is", columnIds: [s.column("to-do").id] },
          ],
        },
        actions: [{ type: "set_status", columnId: s.column("in-progress").id }],
      },
      {
        name: "Checklist",
        trigger: { type: "task_created" },
        conditions: {
          op: "and",
          conditions: [{ field: "title", op: "contains", value: "release" }],
        },
        actions: [{ type: "create_subtask", title: "Notes for {{task.key}}" }],
      },
    ];
    for (const body of rules) {
      const response = await s.createRule(body);
      expect(response.status, await response.clone().text()).toBe(200);
    }

    // Helper tasks take numbers by hand; keep clear of the API's counter.
    const target = await s.task({ title: "Broken link", number: 50 });
    await s.ok(s.owner, "POST", "/label", {
      name: "bug",
      color: "#ff0000",
      taskId: target.id,
      workspaceId: s.workspaceId,
    });
    await s.settle();
    let [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, target.id));
    expect(row?.priority).toBe("urgent");
    expect(row?.dueDate).not.toBeNull();

    await s.ok(s.owner, "POST", "/activity/comment", {
      taskId: target.id,
      comment: "On it",
    });
    await s.settle();
    [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, target.id));
    expect(row?.status).toBe("in-progress");

    const created = await s.ok<{ id: string; number: number }>(
      s.owner,
      "POST",
      `/task/${s.projectId}`,
      {
        title: "Plan the release",
        description: "",
        status: "to-do",
        priority: "low",
      },
    );
    await s.settle();
    const children = await db
      .select()
      .from(schema.taskRelationTable)
      .where(eq(schema.taskRelationTable.sourceTaskId, created.id));
    expect(children).toHaveLength(1);
    const [child] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, children[0]?.targetTaskId ?? ""));
    expect(child?.title).toBe(`Notes for WEB-${created.number}`);
  });

  it("never re-triggers a rule through its own chain and stops at depth 3", async () => {
    const s = await scene();
    const steps: [string, string][] = [
      ["in-progress", "urgent"],
      ["in-review", "low"],
    ];
    // status → priority → status → priority → status: four rules chained.
    const chain = [
      {
        name: "1",
        trigger: { type: "status_changed", to: [s.column("in-progress").id] },
        actions: [{ type: "set_priority", priority: "urgent" }],
      },
      {
        name: "2",
        trigger: { type: "priority_changed", to: ["urgent"] },
        actions: [{ type: "set_status", columnId: s.column("in-review").id }],
      },
      {
        name: "3",
        trigger: { type: "status_changed", to: [s.column("in-review").id] },
        actions: [{ type: "set_priority", priority: "low" }],
      },
      {
        name: "4",
        trigger: { type: "priority_changed", to: ["low"] },
        actions: [{ type: "set_status", columnId: s.column("done").id }],
      },
    ];
    expect(steps).toHaveLength(2);
    const ids: string[] = [];
    for (const body of chain) {
      const rule = await s.ok<Rule>(
        s.ada,
        "POST",
        `/automation-rule/${s.projectId}`,
        body,
      );
      ids.push(rule.id);
    }
    const target = await s.task({ priority: "medium" });
    await s.ok(s.owner, "PUT", `/task/status/${target.id}`, {
      status: "in-progress",
    });
    await s.settle();

    const runs = await s.runs();
    const byRule = new Map(runs.map((run) => [run.ruleId, run]));
    expect(byRule.get(ids[0] ?? "")?.depth).toBe(0);
    expect(byRule.get(ids[2] ?? "")).toMatchObject({
      outcome: "success",
      depth: 2,
    });
    expect(byRule.get(ids[3] ?? "")).toMatchObject({
      outcome: "skipped",
      error: "LOOP_DEPTH",
      depth: 3,
    });
    // Rule 1 never ran again although rule 3 changed the status.
    expect(runs.filter((run) => run.ruleId === ids[0])).toHaveLength(1);
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, target.id));
    expect(row?.status).toBe("in-review");
  });

  it("needs project:update to manage rules and project:read to list them", async () => {
    const s = await scene();
    expect((await s.createRule(reviewerRule(s), s.mia)).status).toBe(403);
    expect((await s.createRule(reviewerRule(s), s.vic)).status).toBe(403);
    const rule = await s.ok<Rule>(
      s.ada,
      "POST",
      `/automation-rule/${s.projectId}`,
      reviewerRule(s),
    );

    const listed = await s.ok<{ rules: Rule[] }>(
      s.vic,
      "GET",
      `/automation-rule/${s.projectId}`,
    );
    expect(listed.rules.map((entry) => entry.id)).toEqual([rule.id]);
    const toggle = (user: typeof s.mia) =>
      s.as(user)("PATCH", `/automation-rule/${s.projectId}/${rule.id}`, {
        enabled: false,
      });
    expect((await toggle(s.mia)).status).toBe(403);
    const off = await toggle(s.ada);
    expect(off.status).toBe(200);
    expect(((await off.json()) as Rule).enabled).toBe(false);
    expect(
      (await s.as(s.outsider)("GET", `/automation-rule/${s.projectId}`)).status,
    ).toBeGreaterThanOrEqual(400);

    // A rule of another project is not found through this one.
    expect(
      (
        await s.as(s.ada)(
          "DELETE",
          `/automation-rule/${s.api.project.id}/${rule.id}`,
        )
      ).status,
    ).toBe(404);

    const audit = await db
      .select({
        action: schema.auditLogTable.action,
        actorType: schema.auditLogTable.actorType,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.targetId, rule.id));
    expect(audit.map((row) => row.action).sort()).toEqual([
      "automation.rule_created",
      "automation.rule_updated",
    ]);
    expect(audit.every((row) => row.actorType === "user")).toBe(true);
  });

  it("validates references against the project", async () => {
    const s = await scene();
    const bad = await s.createRule({
      name: "Wrong project",
      trigger: { type: "status_changed", to: [s.api.columns.done.id] },
      actions: [{ type: "add_comment", template: "{{task.owner}}" }],
    });
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(text).toContain("not a column of this project");
    expect(text).toContain("unknown variable");
  });

  it("keeps restricted projects closed", async () => {
    const s = await scene();
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.projectId));
    await db
      .insert(schema.projectMemberTable)
      .values({ projectId: s.projectId, userId: s.vic.id, role: "member" });

    // Mia can't see the project: she can't be assigned or notified by it.
    const assign = await s.createRule({
      name: "Assign Mia",
      trigger: { type: "task_created" },
      actions: [{ type: "assign", userIds: [s.mia.id] }],
    });
    expect(assign.status).toBe(400);
    expect(await assign.text()).toContain("can't see the project");
    expect(
      (await s.as(s.mia)("GET", `/automation-rule/${s.projectId}`)).status,
    ).toBe(404);

    // Notify assignees: Mia was assigned before the project was restricted.
    await s.ok(s.ada, "POST", `/automation-rule/${s.projectId}`, {
      name: "Tell assignees",
      trigger: { type: "comment_added" },
      actions: [
        { type: "notify", roles: ["assignees"], message: "New comment" },
      ],
    });
    const target = await s.task();
    await db.insert(schema.taskAssigneeTable).values([
      { taskId: target.id, userId: s.mia.id, position: 0 },
      { taskId: target.id, userId: s.vic.id, position: 1 },
    ]);
    await s.ok(s.owner, "POST", "/activity/comment", {
      taskId: target.id,
      comment: "hello",
    });
    await s.settle();
    const notified = await db
      .select({ userId: schema.notificationTable.userId })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.type, "automation_notice"));
    expect(notified.map((row) => row.userId)).toEqual([s.vic.id]);
  });

  it("fires due date passed once per task and due date", async () => {
    const s = await scene();
    const rule = await s.ok<Rule>(
      s.ada,
      "POST",
      `/automation-rule/${s.projectId}`,
      {
        name: "Overdue",
        trigger: { type: "due_date_passed" },
        actions: [{ type: "set_priority", priority: "urgent" }],
      },
    );
    const now = new Date();
    const overdue = await s.task({
      dueDate: new Date(now.getTime() - 3_600_000),
    });
    const done = await s.task({
      status: "done",
      dueDate: new Date(now.getTime() - 3_600_000),
    });
    const later = await s.task({
      dueDate: new Date(now.getTime() + 86_400_000),
    });

    const tick = async () => {
      await db
        .delete(schema.jobLeaseTable)
        .where(eq(schema.jobLeaseTable.name, AUTOMATION_DUE_LEASE));
      return runAutomationDueDates(now);
    };
    expect((await tick()).fired).toBe(1);
    expect((await tick()).fired).toBe(0);
    await s.settle();

    const rows = await db.select().from(schema.taskTable);
    const priority = (id: string) =>
      rows.find((row) => row.id === id)?.priority;
    expect(priority(overdue.id)).toBe("urgent");
    expect(priority(done.id)).not.toBe("urgent");
    expect(priority(later.id)).not.toBe("urgent");
    const runs = await db
      .select()
      .from(automationRunTable)
      .where(eq(automationRunTable.ruleId, rule.id));
    expect(runs).toHaveLength(1);
  });

  it("deletes runs older than the retention", async () => {
    const s = await scene();
    const rule = await s.ok<Rule>(
      s.ada,
      "POST",
      `/automation-rule/${s.projectId}`,
      reviewerRule(s),
    );
    const old = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(automationRunTable).values([
      {
        ruleId: rule.id,
        projectId: s.projectId,
        triggerType: "status_changed",
        outcome: "success",
        createdAt: old,
      },
      {
        ruleId: rule.id,
        projectId: s.projectId,
        triggerType: "status_changed",
        outcome: "success",
      },
    ]);
    await db
      .delete(schema.jobLeaseTable)
      .where(eq(schema.jobLeaseTable.name, AUTOMATION_RETENTION_LEASE));
    const result = await runAutomationRunRetention();
    expect(result.deleted).toBe(1);
    expect(await db.select().from(automationRunTable)).toHaveLength(1);
  });
});
