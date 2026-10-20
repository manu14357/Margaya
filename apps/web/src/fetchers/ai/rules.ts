import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Rule compiler (C5): plain words to a rule in an existing engine's schema,
// and a computed dry run over the project's history. Saving goes through
// the ordinary workflow-rule and project-automation routes.

type RulesClient = (typeof client)["ai"]["rules"];

export type CompiledRules = InferResponseType<
  RulesClient["compile"]["$post"],
  200
>;
export type CompiledRule = CompiledRules["rules"][number];
export type RuleDryRun = InferResponseType<
  RulesClient["dry-run"]["$post"],
  200
>;
export type RuleDryRunInput = InferRequestType<
  RulesClient["dry-run"]["$post"]
>["json"];

export async function compileRule(input: {
  projectId: string;
  prompt: string;
  locale?: string;
}): Promise<CompiledRules> {
  const response = await client.ai.rules.compile.$post({ json: input });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function dryRunRule(input: RuleDryRunInput): Promise<RuleDryRun> {
  const response = await client.ai.rules["dry-run"].$post({ json: input });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
