import { Link } from "@tanstack/react-router";
import { Bot, Check, CircleAlert, Clock, Hand, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import { Button } from "@/components/ui/button";
import { useAgentRun } from "@/hooks/queries/ai/use-agents";
import { cn } from "@/lib/cn";

const MAX_SUMMARY_CHARS = 1200;

function StatusIcon({ status }: { status: string }) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "queued":
      return <Clock className={className} aria-hidden />;
    case "running":
      return (
        <Loader2
          className={cn(className, "motion-safe:animate-spin")}
          aria-hidden
        />
      );
    case "succeeded":
      return <Check className={cn(className, "text-primary")} aria-hidden />;
    case "failed":
      return (
        <CircleAlert
          className={cn(className, "text-destructive-foreground")}
          aria-hidden
        />
      );
    default:
      return <Hand className={className} aria-hidden />;
  }
}

/**
 * A live agent run in chat: status (refreshed by the user socket and a
 * gentle poll while it works), its task, the closing summary and a link to
 * the Agent Desk.
 */
export function AgentRunCard({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const { t } = useTranslation();
  const { data: run, isError } = useAgentRun(workspaceId, runId);
  const status = run?.status;
  const summary = run?.outputSummary?.trim();

  return (
    <section
      aria-label={t("ai:build.chat.agentRun.title")}
      aria-live="polite"
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Bot className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">
          {run?.agent?.name ?? t("ai:build.chat.agentRun.title")}
        </span>
        {status && (
          <span
            className="inline-flex items-center gap-1 text-muted-foreground"
            data-status={status}
          >
            <StatusIcon status={status} />
            {t(`ai:agents.status.${status}`, {
              defaultValue: t("ai:build.chat.agentRun.inProgress"),
            })}
          </span>
        )}
      </header>
      {!run && !isError && (
        <p role="status" className="text-muted-foreground text-xs">
          {t("ai:build.chat.agentRun.loading")}
        </p>
      )}
      {isError && (
        <p role="alert" className="text-destructive-foreground text-xs">
          {t("ai:build.chat.agentRun.loadError")}
        </p>
      )}
      {run?.task && (
        <p className="truncate text-muted-foreground text-xs">
          {run.task.key} {run.task.title}
        </p>
      )}
      {summary && (
        <AiMarkdown
          text={
            summary.length > MAX_SUMMARY_CHARS
              ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…`
              : summary
          }
        />
      )}
      <Button
        size="xs"
        variant="ghost"
        className="w-fit"
        render={
          <Link
            to="/dashboard/workspace/$workspaceId/agents"
            params={{ workspaceId }}
            search={{ runId }}
          />
        }
      >
        {t("ai:agents.run.viewInDesk")}
      </Button>
    </section>
  );
}
