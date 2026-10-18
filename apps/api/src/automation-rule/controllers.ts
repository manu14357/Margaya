import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { memberStatements, satisfies } from "../ai-agent/rights";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  automationRuleTable,
  automationRunTable,
  projectTable,
  taskTable,
} from "../database/schema";
import type { z } from "../openapi";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { forgetAutomationRules } from "./engine";
import { ruleReferenceIssues } from "./references";
import type {
  createAutomationRuleBody,
  updateAutomationRuleBody,
} from "./schema";
import {
  type AutomationRuleDefinition,
  automationActionSchema,
  automationConditionGroupSchema,
  automationTriggerSchema,
} from "./vocabulary";

// Rule CRUD and the run history. The routes check workspace access,
// project visibility and project:read / project:update first.

export const RULES_PER_PROJECT = 100;
const RULE_NOT_FOUND = "Automation rule not found";

type Row = typeof automationRuleTable.$inferSelect;

function toRule(row: Row) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    enabled: row.enabled,
    trigger: automationTriggerSchema.parse(row.trigger),
    conditions: row.conditions
      ? automationConditionGroupSchema.parse(row.conditions)
      : null,
    actions: automationActionSchema.array().parse(row.actions),
    createdBy: row.createdBy,
    runCount: row.runCount,
    failureCount: row.failureCount,
    lastRunAt: row.lastRunAt,
    lastOutcome: (row.lastOutcome ?? null) as
      | "success"
      | "partial"
      | "failed"
      | "skipped"
      | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function projectInfo(projectId: string) {
  const [project] = await db
    .select({ workspaceId: projectTable.workspaceId, name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

async function loadRule(projectId: string, ruleId: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(automationRuleTable)
    .where(
      and(
        eq(automationRuleTable.id, ruleId),
        eq(automationRuleTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: RULE_NOT_FOUND });
  return row;
}

async function assertValid(
  projectId: string,
  rule: AutomationRuleDefinition,
  saver?: { workspaceId: string; userId: string },
) {
  const issues = await ruleReferenceIssues(projectId, rule);
  if (issues.length > 0) {
    throw new HTTPException(400, { message: issues.join("; ") });
  }
  // A "Run agent" action acts for whoever saves the rule.
  if (saver && rule.actions.some((action) => action.type === "run_agent")) {
    const rights = await memberStatements(saver.workspaceId, saver.userId);
    if (!rights || !satisfies(rights, { ai: ["use"] })) {
      throw new HTTPException(403, {
        message: "Run agent acts for you, so you need ai:use",
      });
    }
  }
}

function audit(
  workspaceId: string,
  action:
    | "automation.rule_created"
    | "automation.rule_updated"
    | "automation.rule_deleted",
  row: Pick<Row, "id" | "name" | "projectId">,
  metadata: Record<string, unknown> = {},
) {
  return recordAudit({
    workspaceId,
    action,
    target: { type: "automation_rule", id: row.id, label: row.name },
    metadata: { projectId: row.projectId, ...metadata },
  });
}

export async function listAutomationRules(projectId: string) {
  const rows = await db
    .select()
    .from(automationRuleTable)
    .where(eq(automationRuleTable.projectId, projectId))
    .orderBy(automationRuleTable.createdAt, automationRuleTable.id);
  return { rules: rows.map(toRule) };
}

export async function createAutomationRule(input: {
  projectId: string;
  userId: string;
  body: z.infer<typeof createAutomationRuleBody>;
}) {
  const { projectId, userId, body } = input;
  const project = await projectInfo(projectId);
  await assertValid(projectId, body, {
    workspaceId: project.workspaceId,
    userId,
  });
  const existing = await db
    .select({ id: automationRuleTable.id })
    .from(automationRuleTable)
    .where(eq(automationRuleTable.projectId, projectId))
    .limit(RULES_PER_PROJECT);
  if (existing.length >= RULES_PER_PROJECT) {
    throw new HTTPException(400, {
      message: `A project can have at most ${RULES_PER_PROJECT} automation rules`,
    });
  }
  const [row] = await db
    .insert(automationRuleTable)
    .values({
      projectId,
      name: body.name,
      enabled: body.enabled,
      triggerType: body.trigger.type,
      trigger: body.trigger,
      conditions: body.conditions ?? null,
      actions: body.actions,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();
  if (!row) throw new HTTPException(500, { message: "Failed to save rule" });
  forgetAutomationRules(projectId);
  await audit(project.workspaceId, "automation.rule_created", row, {
    trigger: row.triggerType,
    enabled: row.enabled,
  });
  return toRule(row);
}

export async function updateAutomationRule(input: {
  projectId: string;
  ruleId: string;
  userId: string;
  patch: z.infer<typeof updateAutomationRuleBody>;
}) {
  const { projectId, ruleId, userId, patch } = input;
  const project = await projectInfo(projectId);
  const current = toRule(await loadRule(projectId, ruleId));
  const next: AutomationRuleDefinition = {
    name: patch.name ?? current.name,
    trigger: patch.trigger ?? current.trigger,
    conditions:
      patch.conditions !== undefined ? patch.conditions : current.conditions,
    actions: patch.actions ?? current.actions,
  };
  const definitionChanged =
    patch.trigger !== undefined ||
    patch.conditions !== undefined ||
    patch.actions !== undefined;
  // Turning a rule off always works, even when what it names is gone.
  if (definitionChanged || patch.enabled === true) {
    await assertValid(projectId, next, {
      workspaceId: project.workspaceId,
      userId,
    });
  }
  const [row] = await db
    .update(automationRuleTable)
    .set({
      name: next.name,
      enabled: patch.enabled ?? current.enabled,
      triggerType: next.trigger.type,
      trigger: next.trigger,
      conditions: next.conditions ?? null,
      actions: next.actions,
      updatedBy: userId,
    })
    .where(eq(automationRuleTable.id, ruleId))
    .returning();
  if (!row) throw new HTTPException(404, { message: RULE_NOT_FOUND });
  forgetAutomationRules(projectId);
  await audit(project.workspaceId, "automation.rule_updated", row, {
    changed: Object.keys(patch),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  });
  return toRule(row);
}

export async function deleteAutomationRule(input: {
  projectId: string;
  ruleId: string;
}) {
  const project = await projectInfo(input.projectId);
  const row = await loadRule(input.projectId, input.ruleId);
  await db
    .delete(automationRuleTable)
    .where(eq(automationRuleTable.id, row.id));
  forgetAutomationRules(input.projectId);
  await audit(project.workspaceId, "automation.rule_deleted", row);
  return { id: row.id, deleted: true as const };
}

export async function listAutomationRuns(input: {
  projectId: string;
  ruleId?: string;
  limit: number;
}) {
  const rows = await db
    .select({
      id: automationRunTable.id,
      ruleId: automationRunTable.ruleId,
      ruleName: automationRuleTable.name,
      taskId: automationRunTable.taskId,
      taskNumber: taskTable.number,
      taskTitle: taskTable.title,
      projectSlug: projectTable.slug,
      triggerType: automationRunTable.triggerType,
      outcome: automationRunTable.outcome,
      error: automationRunTable.error,
      actions: automationRunTable.actions,
      depth: automationRunTable.depth,
      createdAt: automationRunTable.createdAt,
    })
    .from(automationRunTable)
    .innerJoin(
      automationRuleTable,
      eq(automationRuleTable.id, automationRunTable.ruleId),
    )
    .innerJoin(projectTable, eq(projectTable.id, automationRunTable.projectId))
    .leftJoin(taskTable, eq(taskTable.id, automationRunTable.taskId))
    .where(
      and(
        eq(automationRunTable.projectId, input.projectId),
        input.ruleId ? eq(automationRunTable.ruleId, input.ruleId) : undefined,
      ),
    )
    .orderBy(desc(automationRunTable.createdAt), desc(automationRunTable.id))
    .limit(input.limit);
  return {
    runs: rows.map(({ taskNumber, projectSlug, actions, ...row }) => ({
      ...row,
      taskKey:
        row.taskId && row.taskTitle !== null
          ? formatTaskKey(projectSlug, taskNumber)
          : null,
      actions: (actions ?? []) as {
        type: string;
        status: "applied" | "unchanged" | "failed";
        error?: string;
      }[],
    })),
  };
}
