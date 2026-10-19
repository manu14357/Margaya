// Outside the ["analytics", workspaceId, scopeKey] tree: reports belong to
// the workspace, not to a scope, and the Refresh button need not refetch them.
export const analyticsReportQueryKeys = {
  list: (workspaceId: string) => ["analytics-reports", workspaceId] as const,
};
