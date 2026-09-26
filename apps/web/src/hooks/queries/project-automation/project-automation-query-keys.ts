import type { AutomationRule } from "@/types/project-automation";

// Under the ["projects"] prefix, so the PROJECT_UPDATED hint (sent when
// another person changes the automations) refreshes them too.
export const projectAutomationQueryKeys = {
  automations: (workspaceId: string, projectId: string) =>
    ["projects", workspaceId, projectId, "automations"] as const,
  preview: (
    workspaceId: string,
    projectId: string,
    rule: AutomationRule,
    months: number,
  ) =>
    [
      "projects",
      workspaceId,
      projectId,
      "automations",
      "preview",
      rule,
      months,
    ] as const,
};
