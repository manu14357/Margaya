import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveWorkspaceAgentIds } from "@/components/ai/agents/use-agent-ids";
import { cn } from "@/lib/cn";

/**
 * The subtle "Agent" marker next to an agent's name: a muted outline chip
 * with a small bot, readable without colour.
 */
export function AgentBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 font-medium text-[10px] text-muted-foreground uppercase leading-4 tracking-wide",
        className,
      )}
    >
      <Bot className="size-2.5" aria-hidden />
      {t("ai:agents.badge")}
    </span>
  );
}

/** The badge when `userId` is one of the active workspace's agents. */
export function AgentBadgeFor({
  userId,
  className,
}: {
  userId: string | null | undefined;
  className?: string;
}) {
  const agentIds = useActiveWorkspaceAgentIds();
  if (!userId || !agentIds.has(userId)) return null;
  return <AgentBadge className={className} />;
}
