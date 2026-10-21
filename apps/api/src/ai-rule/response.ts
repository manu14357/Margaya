import { z } from "../openapi";
import { compiledRuleSchema } from "./vocabulary";

export const compileRuleResultSchema = z
  .object({
    projectId: z.string(),
    status: z.enum(["compiled", "partial", "unsupported"]).openapi({
      description:
        "compiled: every part became a rule; partial: some parts are not supported; unsupported: no rule could be made.",
    }),
    rules: z.array(compiledRuleSchema).openapi({
      description:
        "Valid rules, checked with the engines' own schemas and this project's columns. Nothing is saved.",
    }),
    unsupported: z
      .array(z.object({ request: z.string(), reason: z.string() }))
      .openapi({
        description:
          "Parts of the request no engine can express, in the caller's language. Nothing was invented for them.",
      }),
    rejected: z.number().int().openapi({
      description:
        "Rules the model proposed that failed validation and were dropped.",
    }),
  })
  .openapi("AiCompiledRules");

export const dryRunMatchSchema = z.object({
  taskId: z.string(),
  taskNumber: z.number().int().nullable(),
  title: z.string(),
  at: z.string().nullable().openapi({
    description:
      "When the rule would have fired (ISO time): the integration event, the moment the task crossed the months threshold, or the cycle's end.",
  }),
  kind: z.enum(["move", "archive", "close", "rollover", "automation"]),
  outcome: z.enum(["change", "unchanged", "skipped"]).openapi({
    description:
      "change: the task would have changed (for an automation rule: the trigger and the conditions match); unchanged: it was already there; skipped: the engine leaves it alone (a final column, no next cycle, or the task does not meet the automation rule's conditions).",
  }),
  from: z.string().nullable().openapi({
    description: "Column or cycle name before.",
  }),
  to: z.string().nullable().openapi({
    description: "Column or cycle name after.",
  }),
});

export const dryRunResultSchema = z
  .object({
    projectId: z.string(),
    projectSlug: z.string(),
    engine: z.enum(["workflow_rule", "project_automation", "automation_rule"]),
    days: z.number().int(),
    from: z.string(),
    to: z.string(),
    total: z.number().int().openapi({
      description: "Matches in the window, before the list cap.",
    }),
    changed: z.number().int().openapi({
      description: "Matches whose outcome is a change.",
    }),
    capped: z.boolean(),
    matches: z.array(dryRunMatchSchema),
    notes: z
      .array(
        z.enum([
          "integration_not_connected",
          "branch_push_last_only",
          "threshold_from_last_update",
          "flow_alerts_notify_only",
          "nothing_enabled",
          "conditions_current_state",
        ]),
      )
      .openapi({
        description:
          "Caveats: the integration is not connected; only each branch's last push is known; archive and close replay from each task's last update; flow alerts only notify; the rule turns nothing on; or an automation rule's conditions were checked against each task as it is now.",
      }),
  })
  .openapi("AiRuleDryRun");

export type DryRunMatch = z.infer<typeof dryRunMatchSchema>;
export type DryRunNote = z.infer<typeof dryRunResultSchema>["notes"][number];
