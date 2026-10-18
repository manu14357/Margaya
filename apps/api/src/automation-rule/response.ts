import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  automationActionSchema,
  automationConditionGroupSchema,
  automationTriggerSchema,
} from "./vocabulary";

export const automationRuleSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    trigger: automationTriggerSchema,
    conditions: automationConditionGroupSchema.nullable(),
    actions: z.array(automationActionSchema),
    createdBy: z.string().nullable(),
    runCount: z.number().int(),
    failureCount: z.number().int(),
    lastRunAt: nullableResponseTimestamp,
    lastOutcome: z.enum(["success", "partial", "failed", "skipped"]).nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AutomationRule");

export const automationRuleListSchema = z
  .object({ rules: z.array(automationRuleSchema) })
  .openapi("AutomationRuleList");

export const automationRunSchema = z
  .object({
    id: z.string(),
    ruleId: z.string(),
    ruleName: z.string(),
    taskId: z.string().nullable(),
    taskKey: z.string().nullable(),
    taskTitle: z.string().nullable(),
    triggerType: z.string(),
    outcome: z.enum(["success", "partial", "failed", "skipped"]).openapi({
      description:
        "success: every action applied or had nothing to change; partial: some failed; failed: all failed; skipped: the loop guard (LOOP_DEPTH) or the per-task rate limit (RATE_LIMITED) stopped it.",
    }),
    error: z.string().nullable(),
    actions: z.array(
      z.object({
        type: z.string(),
        status: z.enum(["applied", "unchanged", "failed"]),
        error: z.string().optional(),
      }),
    ),
    depth: z.number().int(),
    createdAt: responseTimestamp,
  })
  .openapi("AutomationRun");

export const automationRunListSchema = z
  .object({ runs: z.array(automationRunSchema) })
  .openapi("AutomationRunList");

export const deletedAutomationRuleSchema = z
  .object({ id: z.string(), deleted: z.literal(true) })
  .openapi("DeletedAutomationRule");
