// A project's estimate systems live under one key; every estimate mutation
// and realtime hint refreshes it.
export const estimateQueryKeys = {
  all: (projectId: string) => ["estimates", projectId] as const,
};
