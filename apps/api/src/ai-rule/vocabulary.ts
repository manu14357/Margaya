import { automationRuleDefinitionSchema } from "../automation-rule/vocabulary";
import { z } from "../openapi";
import { updateProjectAutomationsBody } from "../project-automation/schema";
import { upsertWorkflowRuleBody } from "../workflow-rule/schema";

// What the rule compiler may emit: the two existing automation engines,
// in their own request schemas. Nothing here runs a model at execution time;
// a compiled rule is saved through the ordinary workflow-rule and
// project-automation routes and runs exactly like a hand-made one.
//
// - Workflow rules: an integration event moves the linked task to a column.
//   The events are the ones the GitHub and Gitea webhooks resolve through
//   `workflow_rule` (plugins/*/utils/resolve-column.ts) and the settings
//   editor offers.
// - Project automations: auto-archive, auto-close, cycle rollover and flow
//   alerts, exactly the PATCH body of /project-automation/{projectId}.
// - Automation rules: "When → If → Then" on the project's tasks, exactly
//   the body of POST /automation-rule/{projectId} (automation-rule/).

export const RULE_INTEGRATIONS = ["github", "gitea"] as const;

export const RULE_EVENT_TYPES = [
  "branch_push",
  "pr_opened",
  "pr_merged",
  "issue_opened",
  "issue_closed",
] as const;

export type RuleEventType = (typeof RULE_EVENT_TYPES)[number];

/** The workflow-rule upsert body, narrowed to the events the engine fires. */
export const workflowRuleDraftSchema = upsertWorkflowRuleBody
  .extend({
    integrationType: z.enum(RULE_INTEGRATIONS).openapi({
      description: "The integration whose webhook fires the rule.",
    }),
    eventType: z.enum(RULE_EVENT_TYPES).openapi({
      description:
        "branch_push, pr_opened, pr_merged, issue_opened or issue_closed.",
    }),
    columnId: z.string().min(1).openapi({
      description: "The project column the linked task moves to.",
    }),
  })
  .strict();

export const compiledWorkflowRuleSchema = z
  .object({
    engine: z.literal("workflow_rule"),
    rule: workflowRuleDraftSchema,
  })
  .strict();

export const compiledAutomationSchema = z
  .object({
    engine: z.literal("project_automation"),
    patch: updateProjectAutomationsBody,
  })
  .strict();

export const compiledTaskRuleSchema = z
  .object({
    engine: z.literal("automation_rule"),
    rule: automationRuleDefinitionSchema,
  })
  .strict();

export const compiledRuleSchema = z
  .union([
    compiledWorkflowRuleSchema,
    compiledAutomationSchema,
    compiledTaskRuleSchema,
  ])
  .openapi("CompiledAutomationRule", {
    description:
      "A rule in an existing engine's own schema: a workflow rule (the body of PUT /workflow-rule/{projectId}), a project automation change (the body of PATCH /project-automation/{projectId}) or an automation rule (the body of POST /automation-rule/{projectId}). Save it through that route.",
  });

export type CompiledRule = z.infer<typeof compiledRuleSchema>;
export type CompiledWorkflowRule = z.infer<typeof compiledWorkflowRuleSchema>;
export type CompiledAutomation = z.infer<typeof compiledAutomationSchema>;
export type CompiledTaskRule = z.infer<typeof compiledTaskRuleSchema>;

/**
 * The model's answer schema for one project: the engines' schemas with
 * column ids narrowed to this project's columns, plus the parts of the
 * request no engine can express.
 */
export function compilerOutputSchema(columns: {
  all: readonly string[];
  cancelled: readonly string[];
}) {
  const [firstColumn, ...otherColumns] = columns.all;
  const columnId = firstColumn
    ? z.enum([firstColumn, ...otherColumns])
    : z.string();
  const [firstCancelled, ...otherCancelled] = columns.cancelled;
  const autoCloseColumn = firstCancelled
    ? z.enum([firstCancelled, ...otherCancelled]).nullable()
    : z.null();

  const autoClose = updateProjectAutomationsBody.shape.autoClose.unwrap();
  const patch = updateProjectAutomationsBody.extend({
    autoClose: autoClose
      .extend({ columnId: autoCloseColumn.optional() })
      .optional(),
  });

  return z
    .object({
      rules: z.array(
        z.union([
          compiledWorkflowRuleSchema.extend({
            rule: workflowRuleDraftSchema.extend({ columnId }),
          }),
          compiledAutomationSchema.extend({ patch }),
          compiledTaskRuleSchema,
        ]),
      ),
      unsupported: z.array(
        z
          .object({
            request: z.string().openapi({
              description: "The part of the request, quoted or paraphrased.",
            }),
            reason: z.string().openapi({
              description: "Why no engine can express it, in one sentence.",
            }),
          })
          .strict(),
      ),
    })
    .strict();
}

// Structured output accepts a subset of JSON Schema: no numeric or length
// bounds. The Zod check after the call still enforces them.
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = sanitize(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** A provider-neutral JSON Schema derived from a Zod schema. */
export function modelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return sanitize(z.toJSONSchema(schema)) as Record<string, unknown>;
}
