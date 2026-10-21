import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";
import { compiledRuleSchema } from "./vocabulary";

// Request schemas of the rule compiler routes (ai-rule/index.ts).

export const DRY_RUN_DEFAULT_DAYS = 30;
export const DRY_RUN_MAX_DAYS = 90;

export const compileRuleBody = z
  .strictObject({
    projectId: z.string().min(1).openapi({
      description: "The project the rule is for.",
    }),
    prompt: z.string().trim().min(3).max(1000).openapi({
      description:
        'The rule in plain words, e.g. "when a GitHub pull request is merged, move the task to Done".',
    }),
    locale: answerLocale,
  })
  .openapi("AiCompileRuleInput");

export const dryRunRuleBody = z
  .strictObject({
    projectId: z.string().min(1).openapi({
      description: "The project whose history is replayed.",
    }),
    rule: compiledRuleSchema,
    days: z
      .number()
      .int()
      .min(1)
      .max(DRY_RUN_MAX_DAYS)
      .default(DRY_RUN_DEFAULT_DAYS)
      .openapi({ description: "How many days of history to replay, 1-90." }),
  })
  .openapi("AiRuleDryRunInput");
