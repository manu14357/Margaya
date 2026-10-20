import {
  AgentRunCard,
  type BuildSession,
  BuildTurn,
  type BuildTurnState,
  useBuildSession,
} from "@/components/ai/build";

export { historyOf } from "@/components/ai/build";

// Build mode and live agent runs inside the Ask chat. The cards come from
// components/ai/build; this bridge keeps the chat's use of them in one place.

export const BUILD_MODE_AVAILABLE = true;

export type AskBuildTurn = BuildTurnState;

export function useAskBuild(input: {
  workspaceId: string | undefined;
  projectId: string | null;
}) {
  return useBuildSession(input);
}

/** One Build exchange with its proposal cards, Confirm/Cancel and Undo. */
export function AskBuildTurnView({
  session,
  turn,
  workspaceId,
  onOpen,
  onAnswer,
}: {
  session: BuildSession;
  turn: AskBuildTurn;
  workspaceId: string;
  onOpen: (url: string) => void;
  /** Sends a picked answer as the next Build request, shown in the chat. */
  onAnswer: (option: string, autopilot: boolean) => void;
}) {
  return (
    <BuildTurn
      turn={turn}
      workspaceId={workspaceId}
      onConfirm={() => void session.apply(turn.id)}
      onCancel={() => session.cancel(turn.id)}
      onUndo={(actionId) => void session.undo(turn.id, actionId)}
      onEdit={(actionId, next) => session.editAction(turn.id, actionId, next)}
      onRemove={(actionId) => session.removeAction(turn.id, actionId)}
      onToggleDestructive={(actionId) =>
        session.toggleConfirmed(turn.id, actionId)
      }
      onAnswer={(option) => onAnswer(option, turn.autopilot !== null)}
      onOpen={onOpen}
    />
  );
}

export function AskAgentRun(props: { workspaceId: string; runId: string }) {
  return <AgentRunCard {...props} />;
}
