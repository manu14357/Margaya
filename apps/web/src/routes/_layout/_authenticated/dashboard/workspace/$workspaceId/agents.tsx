import { createFileRoute } from "@tanstack/react-router";
import AgentDesk from "@/components/ai/agents/agent-desk";
import type { AgentRunStatus } from "@/fetchers/ai/agents";
import { RUN_STATUSES } from "@/lib/ai/agents";

type AgentDeskSearch = {
  runId?: string;
  agentId?: string;
  status?: AgentRunStatus;
};

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/agents",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): AgentDeskSearch => ({
    runId: text(search.runId),
    agentId: text(search.agentId),
    status: RUN_STATUSES.includes(search.status as AgentRunStatus)
      ? (search.status as AgentRunStatus)
      : undefined,
  }),
});

function RouteComponent() {
  const { workspaceId } = Route.useParams();
  const { runId, agentId, status } = Route.useSearch();
  return (
    <AgentDesk
      workspaceId={workspaceId}
      runId={runId}
      agentId={agentId}
      status={status}
    />
  );
}
