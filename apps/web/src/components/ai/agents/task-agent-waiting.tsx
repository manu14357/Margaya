import { createContext, useContext } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { useAgentApprovals, useAgentRuns } from "@/hooks/queries/ai/use-agents";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { ApprovalCard } from "./approval-card";
import { NeedsInputPanel } from "./run-reply";

/**
 * The agent question or approval a surrounding view already shows above
 * the task (the inbox preview of its notification), so the task body does
 * not repeat it.
 */
export const AgentItemShownAbove = createContext<{
  runId?: string;
  approvalId?: string;
}>({});

/**
 * Agent runs on this task that wait for the current person: questions to
 * answer and changes to approve. Only the run's person may answer or
 * decide (the API enforces it), so other people's runs stay out.
 */
export function TaskAgentWaiting({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
}) {
  const { user } = useAuth();
  const { canUse } = useAiAvailability(projectId);
  const shown = useContext(AgentItemShownAbove);
  const userId = user?.id;
  const enabled = canUse && Boolean(userId && taskId);

  const asking = useAgentRuns(
    workspaceId,
    { taskId, status: "needs_input" },
    enabled,
  );
  const awaiting = useAgentRuns(
    workspaceId,
    { taskId, status: "awaiting_approval" },
    enabled,
  );
  const myAwaiting = new Set(
    (awaiting.data ?? [])
      .filter((run) => run.principal?.id === userId)
      .map((run) => run.id),
  );
  // The approvals list is the person's own; fetch it only when one of
  // their runs on this task holds a change.
  const approvals = useAgentApprovals(
    workspaceId,
    enabled && myAwaiting.size > 0,
  );

  if (!enabled) return null;

  const questions = (asking.data ?? []).flatMap((run) =>
    run.status === "needs_input" &&
    run.principal?.id === userId &&
    run.task?.id === taskId &&
    run.question &&
    run.id !== shown.runId
      ? [{ run, question: run.question }]
      : [],
  );
  const changes = (approvals.data ?? []).filter(
    (approval) =>
      myAwaiting.has(approval.runId) && approval.id !== shown.approvalId,
  );

  if (questions.length === 0 && changes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {questions.map(({ run, question }) => (
        <NeedsInputPanel
          key={run.id}
          workspaceId={workspaceId}
          runId={run.id}
          question={question}
          agentName={run.agent?.name}
        />
      ))}
      {changes.map((approval) => (
        <ApprovalCard
          key={approval.id}
          workspaceId={workspaceId}
          runId={approval.runId}
          approvalId={approval.id}
        />
      ))}
    </div>
  );
}
