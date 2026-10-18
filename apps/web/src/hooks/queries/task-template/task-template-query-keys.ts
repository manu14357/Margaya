// Under the ["projects"] prefix, so the PROJECT_UPDATED hint (sent when
// someone changes the templates) refreshes them too.
export const taskTemplateQueryKeys = {
  list: (workspaceId: string, projectId: string) =>
    ["projects", workspaceId, projectId, "task-templates"] as const,
};
