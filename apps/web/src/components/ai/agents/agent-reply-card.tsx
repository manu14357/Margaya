import { Link } from "@tanstack/react-router";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import { Button } from "@/components/ui/button";

/** The run an agent-answer notification points at, if it is one. */
export function agentReplyOf(notification: {
  type: string;
  content: string | null;
  eventData: unknown;
}): {
  runId: string;
  agentName: string | null;
  text: string;
  /** The agent paused to ask a question; the answer goes in the Desk. */
  needsInput: boolean;
} | null {
  if (notification.type !== "ai_agent_reply") return null;
  const data = notification.eventData as Record<string, unknown> | null;
  if (typeof data?.runId !== "string" || !notification.content) return null;
  return {
    runId: data.runId,
    agentName: typeof data.agentName === "string" ? data.agentName : null,
    text: notification.content,
    needsInput: data.needsInput === true,
  };
}

/**
 * An agent's answer that isn't on the task (it couldn't, or didn't,
 * comment), or its question, shown in the inbox with a link to its run.
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
      </header>
      <AiMarkdown text={text} />
      <p className="text-muted-foreground text-xs">
        {t(
          needsInput
            ? "ai:agents.needsInput.inboxHint"
            : "ai:agents.reply.hint",
        )}
      </p>
      <Button
        size="xs"
        variant={needsInput ? "default" : "ghost"}
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
          needsInput
            ? "ai:agents.needsInput.answer"
            : "ai:agents.run.viewInDesk",
        )}
      </Button>
    </section>
  );
}
