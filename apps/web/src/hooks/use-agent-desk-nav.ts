import { useAgentApprovals, useAgents } from "@/hooks/queries/ai/use-agents";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";

/**
 * Whether Your work offers the Agent Desk: once the workspace has agents and
 * AI is usable here, or while the Desk is open. `waiting` counts approvals.
 */
export function useAgentDeskNav(workspaceId: string, active: boolean) {
  const ai = useAiAvailability();
  const { data: agents } = useAgents(ai.available ? workspaceId : undefined);
  const show = ai.available && ((agents ?? []).length > 0 || active);
  const { data: approvals } = useAgentApprovals(workspaceId, show);
  return { show, waiting: approvals?.length ?? 0 };
}
