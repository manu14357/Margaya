import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AutomationRule,
  type AutomationRuleInput,
  type AutomationRuleList,
  type AutomationRulePatch,
  createAutomationRule,
  deleteAutomationRule,
  updateAutomationRule,
} from "@/fetchers/automation-rule/automation-rules";
import { automationRuleQueryKeys } from "@/hooks/queries/automation-rule/use-automation-rules";

function useInvalidate(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: automationRuleQueryKeys.all(projectId),
    });
}

export function useCreateAutomationRule(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (input: AutomationRuleInput) =>
      createAutomationRule(projectId, input),
    onSettled: invalidate,
  });
}

/** Saves a change; a toggle moves the switch at once, and back on error. */
export function useUpdateAutomationRule(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidate(projectId);
  const key = automationRuleQueryKeys.rules(projectId);
  return useMutation({
    mutationFn: ({
      ruleId,
      patch,
    }: {
      ruleId: string;
      patch: AutomationRulePatch;
    }) => updateAutomationRule(projectId, ruleId, patch),
    onMutate: async ({ ruleId, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AutomationRuleList>(key);
      if (previous && patch.enabled !== undefined) {
        queryClient.setQueryData<AutomationRuleList>(key, {
          rules: previous.rules.map((rule: AutomationRule) =>
            rule.id === ruleId
              ? { ...rule, enabled: Boolean(patch.enabled) }
              : rule,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });
}

export function useDeleteAutomationRule(projectId: string) {
  const invalidate = useInvalidate(projectId);
  return useMutation({
    mutationFn: (ruleId: string) => deleteAutomationRule(projectId, ruleId),
    onSettled: invalidate,
  });
}
