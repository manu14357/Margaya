import { useQuery } from "@tanstack/react-query";
import {
  getAutomationRules,
  getAutomationRuns,
} from "@/fetchers/automation-rule/automation-rules";

export const automationRuleQueryKeys = {
  all: (projectId: string) => ["automation-rules", projectId] as const,
  rules: (projectId: string) =>
    ["automation-rules", projectId, "list"] as const,
  runs: (projectId: string, ruleId?: string) =>
    ["automation-rules", projectId, "runs", ruleId ?? "all"] as const,
};

export function useAutomationRules(projectId: string) {
  return useQuery({
    queryKey: automationRuleQueryKeys.rules(projectId),
    queryFn: () => getAutomationRules(projectId),
    enabled: Boolean(projectId),
  });
}

/** The latest runs; refreshed while the history is open. */
export function useAutomationRuns(
  projectId: string,
  { ruleId, enabled = true }: { ruleId?: string; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: automationRuleQueryKeys.runs(projectId, ruleId),
    queryFn: () => getAutomationRuns(projectId, ruleId),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}
