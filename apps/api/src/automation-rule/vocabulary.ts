import { z } from "../openapi";
import { VALID_PRIORITIES } from "../task/validate-task-fields";

// The "When → If → Then" rule language: one trigger, optional conditions
// (AND/OR groups, two levels deep) and up to ten actions on the triggering
// task. Everything here is plain data checked with Zod; the engine
// (engine.ts) evaluates it without a model. The rule compiler emits rules
// in exactly this schema (ai-rule/vocabulary.ts).
//
// References: columns, users, cycles, modules and custom fields by id;
// labels by name, because a label on a task is a copy of the workspace
// label with the same name.

const id = z.string().min(1).max(64);
const ids = (description: string) =>
  z.array(id).max(50).openapi({ description });
const labelName = z.string().trim().min(1).max(50);
const priority = z.enum(VALID_PRIORITIES);

export const TRIGGER_TYPES = [
  "task_created",
  "status_changed",
  "assignee_added",
  "assignee_removed",
  "label_added",
  "label_removed",
  "priority_changed",
  "due_date_set",
  "due_date_passed",
  "comment_added",
  "moved_to_cycle",
  "moved_to_module",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

const ANY = "Empty or left out: any.";

export const automationTriggerSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("task_created"),
      fromIntake: z.boolean().optional().openapi({
        description: "Only tasks created by accepting an intake request.",
      }),
    }),
    z.strictObject({
      type: z.literal("status_changed"),
      from: ids(`Column ids the task left. ${ANY}`).optional(),
      to: ids(`Column ids the task entered. ${ANY}`).optional(),
    }),
    z.strictObject({
      type: z.literal("assignee_added"),
      userIds: ids(`Only when one of these people is added. ${ANY}`).optional(),
    }),
    z.strictObject({
      type: z.literal("assignee_removed"),
      userIds: ids(
        `Only when one of these people is removed. ${ANY}`,
      ).optional(),
    }),
    z.strictObject({
      type: z.literal("label_added"),
      labels: z
        .array(labelName)
        .max(20)
        .optional()
        .openapi({
          description: `Label names. ${ANY}`,
        }),
    }),
    z.strictObject({
      type: z.literal("label_removed"),
      labels: z
        .array(labelName)
        .max(20)
        .optional()
        .openapi({
          description: `Label names. ${ANY}`,
        }),
    }),
    z.strictObject({
      type: z.literal("priority_changed"),
      to: z
        .array(priority)
        .max(5)
        .optional()
        .openapi({
          description: `The new priority. ${ANY}`,
        }),
    }),
    z.strictObject({ type: z.literal("due_date_set") }),
    z.strictObject({ type: z.literal("due_date_passed") }),
    z.strictObject({ type: z.literal("comment_added") }),
    z.strictObject({
      type: z.literal("moved_to_cycle"),
      cycleIds: ids(`Cycle ids. ${ANY}`).optional(),
    }),
    z.strictObject({
      type: z.literal("moved_to_module"),
      moduleIds: ids(`Module ids. ${ANY}`).optional(),
    }),
  ])
  .openapi("AutomationTrigger", {
    description:
      "When the rule runs. due_date_passed is checked hourly and fires once per task and due date, for open tasks whose due date passed in the last two days.",
  });
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationConditionSchema = z
  .discriminatedUnion("field", [
    z.strictObject({
      field: z.literal("status"),
      op: z.enum(["is", "is_not"]),
      columnIds: z.array(id).min(1).max(50),
    }),
    z.strictObject({
      field: z.literal("labels"),
      op: z.enum(["contains", "not_contains"]).openapi({
        description:
          "contains: the task has one of the labels; not_contains: none of them.",
      }),
      labels: z.array(labelName).min(1).max(20),
    }),
    z.strictObject({
      field: z.literal("priority"),
      op: z.enum(["is", "is_not"]),
      values: z.array(priority).min(1).max(5),
    }),
    z.strictObject({
      field: z.literal("assignee"),
      op: z.enum(["is", "is_not", "empty", "not_empty"]).openapi({
        description:
          "is: one of the people is assigned; is_not: none of them is; empty and not_empty ignore userIds.",
      }),
      userIds: z.array(id).max(50).optional(),
    }),
    z.strictObject({
      field: z.literal("due_date"),
      op: z.enum(["set", "not_set"]),
    }),
    z.strictObject({
      field: z.literal("estimate"),
      op: z.enum(["set", "not_set", "gte", "lte"]),
      value: z.number().min(0).max(100_000).optional().openapi({
        description: "The points to compare with, for gte and lte.",
      }),
    }),
    z.strictObject({
      field: z.literal("title"),
      op: z.enum(["contains", "not_contains"]),
      value: z.string().trim().min(1).max(200).openapi({
        description: "Compared case-insensitively.",
      }),
    }),
    z.strictObject({
      field: z.literal("custom_field"),
      fieldId: id,
      op: z.enum(["equals", "not_equals"]),
      value: z.string().max(500),
    }),
  ])
  .openapi("AutomationCondition");
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

const leafGroupSchema = z.strictObject({
  op: z.enum(["and", "or"]),
  conditions: z.array(automationConditionSchema).min(1).max(20),
});

export const automationConditionGroupSchema = z
  .strictObject({
    op: z.enum(["and", "or"]),
    conditions: z
      .array(z.union([automationConditionSchema, leafGroupSchema]))
      .min(1)
      .max(20),
  })
  .openapi("AutomationConditionGroup", {
    description:
      "All (and) or any (or) of the conditions; an item may itself be a group of conditions.",
  });
export type AutomationConditionGroup = z.infer<
  typeof automationConditionGroupSchema
>;

/** The variables comment, subtask and notification templates may use. */
export const TEMPLATE_VARIABLES = [
  "task.title",
  "task.key",
  "task.status",
  "task.priority",
  "task.dueDate",
  "project.name",
  "rule.name",
] as const;

const template = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .openapi({
      description: `Text; may use ${TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}.`,
    });

export const NOTIFY_ROLES = ["assignees", "creator", "lead"] as const;

export const automationActionSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("set_status"), columnId: id }),
    z.strictObject({
      type: z.literal("assign"),
      userIds: z.array(id).min(1).max(10),
    }),
    z.strictObject({
      type: z.literal("unassign"),
      userIds: z.array(id).max(10).openapi({
        description: "Empty: unassign everyone.",
      }),
    }),
    z.strictObject({ type: z.literal("add_label"), label: labelName }),
    z.strictObject({ type: z.literal("remove_label"), label: labelName }),
    z.strictObject({ type: z.literal("set_priority"), priority }),
    z.strictObject({
      type: z.literal("set_due_date"),
      offsetDays: z.number().int().min(0).max(365).openapi({
        description:
          "Days after the day the rule runs, in the workspace's time zone (0: today).",
      }),
    }),
    z.strictObject({
      type: z.literal("add_comment"),
      template: template(2000),
    }),
    z.strictObject({ type: z.literal("move_to_cycle"), cycleId: id }),
    z.strictObject({ type: z.literal("move_to_module"), moduleId: id }),
    z.strictObject({
      type: z.literal("create_subtask"),
      title: template(200),
    }),
    z.strictObject({
      type: z.literal("run_agent"),
      agentId: id.openapi({
        description: "The agent (agent id, not user id).",
      }),
      prompt: template(2000).openapi({
        description: `What the agent should do with the task. May use ${TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(", ")}. The run acts for the person who last saved the rule (they need ai:use) and never starts for changes an agent made.`,
      }),
    }),
    z.strictObject({
      type: z.literal("notify"),
      userIds: z.array(id).max(20).optional(),
      roles: z.array(z.enum(NOTIFY_ROLES)).max(3).optional().openapi({
        description:
          "assignees: the task's assignees; creator: who created it; lead: the project lead.",
      }),
      message: template(500).optional(),
    }),
  ])
  .openapi("AutomationAction");
export type AutomationAction = z.infer<typeof automationActionSchema>;
export type AutomationActionType = AutomationAction["type"];

export const automationRuleDefinitionSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  trigger: automationTriggerSchema,
  conditions: automationConditionGroupSchema.nullable().optional(),
  actions: z.array(automationActionSchema).min(1).max(10),
});
export type AutomationRuleDefinition = z.infer<
  typeof automationRuleDefinitionSchema
>;

/** Template variables a text uses that do not exist. */
export function unknownTemplateVariables(text: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const unknown = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const name = match[1] ?? "";
    if (!known.has(name)) unknown.add(name);
  }
  return [...unknown];
}
