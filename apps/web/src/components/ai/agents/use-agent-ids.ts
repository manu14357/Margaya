import { useAgentUserIds } from "@/hooks/queries/ai/use-agents";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** The active workspace's agent user ids (empty until loaded). */
export function useActiveWorkspaceAgentIds(): ReadonlySet<string> {
  const { data: workspace } = useActiveWorkspace();
  return useAgentUserIds(workspace?.id);
}

/**
 * Members without the agents, for pickers that are for people only
 * (ownership, leads, invitations). Assignee and mention pickers keep them.
 */
export function withoutAgents<T>(
  items: readonly T[] | undefined,
  agentIds: ReadonlySet<string>,
  userIdOf: (item: T) => string | null | undefined,
): T[] {
  if (!items) return [];
  if (agentIds.size === 0) return [...items];
  return items.filter((item) => {
    const id = userIdOf(item);
    return !id || !agentIds.has(id);
  });
}
