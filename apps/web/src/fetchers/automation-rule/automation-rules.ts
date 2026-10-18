import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Project automation rules ("When → If → Then"): list, create, update or
// toggle, delete, and the run history.

type Rules = (typeof client)["automation-rule"];

export type AutomationRuleList = InferResponseType<
  Rules[":projectId"]["$get"],
  200
>;
export type AutomationRule = AutomationRuleList["rules"][number];
export type AutomationRuleInput = InferRequestType<
  Rules[":projectId"]["$post"]
>["json"];
export type AutomationRulePatch = InferRequestType<
  Rules[":projectId"][":ruleId"]["$patch"]
>["json"];
export type AutomationRunList = InferResponseType<
  Rules[":projectId"]["runs"]["$get"],
  200
>;
export type AutomationRun = AutomationRunList["runs"][number];

export type AutomationTrigger = AutomationRule["trigger"];
export type AutomationConditions = NonNullable<AutomationRule["conditions"]>;
export type AutomationCondition = Extract<
  AutomationConditions["conditions"][number],
  { field: string }
>;
export type AutomationAction = AutomationRule["actions"][number];

async function fail(response: Response): Promise<never> {
  throw new HttpError(response.status, await response.text());
}

export async function getAutomationRules(
  projectId: string,
): Promise<AutomationRuleList> {
  const response = await client["automation-rule"][":projectId"].$get({
    param: { projectId },
  });
  if (!response.ok) return fail(response);
  return response.json();
}

export async function getAutomationRuns(
  projectId: string,
  ruleId?: string,
): Promise<AutomationRunList> {
  const response = await client["automation-rule"][":projectId"].runs.$get({
    param: { projectId },
    query: { limit: "50", ...(ruleId ? { ruleId } : {}) },
  });
  if (!response.ok) return fail(response);
  return response.json();
}

export async function createAutomationRule(
  projectId: string,
  json: AutomationRuleInput,
): Promise<AutomationRule> {
  const response = await client["automation-rule"][":projectId"].$post({
    param: { projectId },
    json,
  });
  if (!response.ok) return fail(response);
  return response.json();
}

export async function updateAutomationRule(
  projectId: string,
  ruleId: string,
  json: AutomationRulePatch,
): Promise<AutomationRule> {
  const response = await client["automation-rule"][":projectId"][
    ":ruleId"
  ].$patch({ param: { projectId, ruleId }, json });
  if (!response.ok) return fail(response);
  return response.json();
}

export async function deleteAutomationRule(
  projectId: string,
  ruleId: string,
): Promise<{ id: string; deleted: true }> {
  const response = await client["automation-rule"][":projectId"][
    ":ruleId"
  ].$delete({ param: { projectId, ruleId } });
  if (!response.ok) return fail(response);
  return response.json();
}
