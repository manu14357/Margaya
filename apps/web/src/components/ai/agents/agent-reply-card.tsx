import { Link } from "@tanstack/react-router";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiGeneratedBadge } from "@/components/ai/ai-content-label";
import AiMarkdown from "@/components/ai/ai-markdown";
import { Button } from "@/components/ui/button";
import { useAgentRun } from "@/hooks/queries/ai/use-agents";
import { stripModelTokens } from "@/lib/model-tokens";
import { NeedsInputPanel } from "./run-reply";

/** The run an agent-answer notification points at, if it is one. */
export function agentReplyOf(notification: {
  type: string;
  content: string | null;
  eventData: unknown;
}): {
  runId: string;
  agentName: string | null;
  text: string;
  /** The agent paused to ask a question. */
  needsInput: boolean;
} | null {
  if (notification.type !== "ai_agent_reply") return null;
  const data = notification.eventData as Record<string, unknown> | null;
  // Answers stored before the API stripped a model's control tokens.
  const text = stripModelTokens(notification.content ?? "");
  if (typeof data?.runId !== "string" || !text) return null;
  return {
    runId: data.runId,
    agentName: typeof data.agentName === "string" ? data.agentName : null,
    text,
    needsInput: data.needsInput === true,
  };
}

/**
 * An agent's answer that isn't on the task (it couldn't, or didn't,
 * comment), or its question, shown in the inbox with a link to its run.
 * While the run still waits for this person, the question is answered
 * right here.
 */
export function AgentReplyCard({
  workspaceId,
  runId,
  agentName,
  text,
  needsInput = false,
}: {
  workspaceId: string;
  runId: string;
  agentName: string | null;
  text: string;
  needsInput?: boolean;
}) {
  const { t } = useTranslation();
  // The run's live state: the question is only there for the person it
  // asked, and only while the run waits.
  const run = useAgentRun(workspaceId, needsInput ? runId : null);
  const live = run.data?.status === "needs_input" ? run.data.question : null;
  // Until the run loads (or when it can't), keep the notification's own
  // wording; once it has moved on, the question no longer waits.
  const waiting = needsInput && (live !== null || !run.data);
  if (live) {
    return (
      <NeedsInputPanel
        workspaceId={workspaceId}
        runId={runId}
        question={live}
        agentName={agentName}
      />
    );
  }
  const title = needsInput
    ? t("ai:agents.needsInput.title")
    : t("ai:agents.reply.cardTitle");
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        {needsInput ? (
          <MessageCircleQuestion
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <span className="font-medium text-foreground">{title}</span>
        {agentName && (
          <span className="text-muted-foreground">{agentName}</span>
        )}
        <AiGeneratedBadge />
      </header>
      <AiMarkdown text={text} safeLinks className="wrap-anywhere" />
      {(waiting || !needsInput) && (
        <p className="text-muted-foreground text-xs">
          {t(
            needsInput
              ? "ai:agents.needsInput.inboxHint"
              : "ai:agents.reply.hint",
          )}
        </p>
      )}
      <Button
        size="xs"
        variant={waiting ? "default" : "ghost"}
        className="w-fit"
        render={
          <Link
            to="/dashboard/workspace/$workspaceId/agents"
            params={{ workspaceId }}
            search={{ runId }}
          />
        }
      >
        {t(
          waiting ? "ai:agents.needsInput.answer" : "ai:agents.run.viewInDesk",
        )}
      </Button>
    </section>
  );
}
