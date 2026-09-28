/** Query keys for a task description's saved versions. */
export const descriptionVersionKeys = {
  list: (taskId: string) => ["task-description-versions", taskId] as const,
  detail: (taskId: string, versionId: string) =>
    ["task-description-versions", taskId, versionId] as const,
};
