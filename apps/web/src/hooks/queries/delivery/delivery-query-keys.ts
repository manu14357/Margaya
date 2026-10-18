import type { DeliveryScopeType } from "@/types/delivery";

// Every forecast and risk query of a project shares the ["delivery",
// projectId] prefix, which planning-progress invalidation refreshes with
// cycle and module progress.
export const deliveryQueryKeys = {
  all: (projectId: string) => ["delivery", projectId] as const,
  forecast: (projectId: string, scope: DeliveryScopeType, id: string) =>
    ["delivery", projectId, "forecast", scope, id] as const,
  risks: (projectId: string, scope: DeliveryScopeType, id: string) =>
    ["delivery", projectId, "risks", scope, id] as const,
  home: (workspaceId: string) => ["delivery-home", workspaceId] as const,
};
