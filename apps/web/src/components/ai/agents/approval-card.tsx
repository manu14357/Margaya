import { Link } from "@tanstack/react-router";
import { Check, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDecideAgentApproval } from "@/hooks/mutations/ai/use-agent-mutations";
import { useAgentRun } from "@/hooks/queries/ai/use-agents";
import { STEP_STATUS_KEYS, toolLabel } from "@/lib/ai/agents";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { ChangePreview } from "./change-preview";

/**
 * A change an agent proposed, with Approve and Reject for the person it
 * waits for (the inbox and the Agent Desk). Decided or expired approvals
 * show their outcome instead.
 */
export function ApprovalCard({
  workspaceId,
  runId,
  approvalId,
  showDeskLink = true,
}: {
  workspaceId: string;
  runId: string;
  approvalId: string;
  /** "Open in Agent Desk"; off inside the Agent Desk itself. */
  showDeskLink?: boolean;
}) {
  const { t } = useTranslation();
  const run = useAgentRun(workspaceId, runId);
  const decide = useDecideAgentApproval();
  const step = run.data?.steps.find((s) => s.approval?.id === approvalId);

  if (run.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!run.data || !step?.approval) return null;

  const onDecide = async (decision: "approve" | "reject") => {
    try {
      await decide.mutateAsync({ workspaceId, approvalId, decision });
      toast.success(
        t(
          decision === "approve"
            ? "ai:agents.change.approved"
            : "ai:agents.change.rejected",
        ),
      );
    } catch {
      toast.error(t("ai:agents.change.decideError"));
    }
  };

  return (
    <section
      aria-label={t("ai:agents.inbox.cardTitle")}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">
          {t("ai:agents.inbox.cardTitle")}
        </span>
        <span className="text-muted-foreground">
          {run.data.agent?.name ?? ""} · {toolLabel(t, step.toolName)}
        </span>
        <span className="ms-auto text-muted-foreground">
          {step.approval.status === "pending"
            ? t("ai:agents.change.expiresAt", {
                time: formatDateTime(step.approval.expiresAt),
              })
            : t(STEP_STATUS_KEYS[step.status] ?? step.status)}
        </span>
      </header>
      <ChangePreview change={step.change} links={step.links} />
      <div className="flex flex-wrap items-center gap-2">
        {step.approval.canDecide && (
          <>
            <Button
              size="xs"
              onClick={() => void onDecide("approve")}
              disabled={decide.isPending}
            >
              <Check aria-hidden />
              {t("ai:agents.change.approve")}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void onDecide("reject")}
              disabled={decide.isPending}
            >
              <X aria-hidden />
              {t("ai:agents.change.reject")}
            </Button>
          </>
        )}
        {showDeskLink && (
          <Button
            size="xs"
            variant="ghost"
            className="ms-auto"
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
        )}
      </div>
    </section>
  );
}
