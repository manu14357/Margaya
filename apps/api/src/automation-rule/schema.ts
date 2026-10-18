import { z } from "../openapi";
import {
  automationActionSchema,
  automationConditionGroupSchema,
  automationTriggerSchema,
} from "./vocabulary";

// Request schemas of the automation rule routes (index.ts).

export const automationProjectParam = z.object({
  projectId: z.string().min(1),
});

export const automationRuleParam = z.object({
  projectId: z.string().min(1),
  ruleId: z.string().min(1),
});

const name = z.string().trim().min(1).max(120).openapi({
  description: "What the rule is for, shown in the list.",
});

export const createAutomationRuleBody = z
  .strictObject({
    name,
    enabled: z.boolean().default(true),
    trigger: automationTriggerSchema,
    conditions: automationConditionGroupSchema.nullable().optional(),
    actions: z.array(automationActionSchema).min(1).max(10),
  })
  .openapi("CreateAutomationRuleInput");

export const updateAutomationRuleBody = z
  .strictObject({
    name: name.optional(),
    enabled: z.boolean().optional(),
    trigger: automationTriggerSchema.optional(),
    conditions: automationConditionGroupSchema.nullable().optional(),
    actions: z.array(automationActionSchema).min(1).max(10).optional(),
  })
  .openapi("UpdateAutomationRuleInput", {
    description: "Send what changes; `enabled` alone turns the rule on or off.",
  });

export const automationRunsQuery = z.object({
  ruleId: z.string().min(1).optional().openapi({
    description: "Only this rule's runs.",
  }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
