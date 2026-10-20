import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAiBudgetStatus } from "@/fetchers/ai/budget";
import { formatCostMicros } from "@/lib/ai/format";

export const aiBudgetKey = (workspaceId: string) =>
  ["ai", "budget-status", workspaceId] as const;

/**
 * The 80% budget warning: shown once the workspace has used 80% of its
 * monthly AI cap (and as "reached" from 100%, when AI calls stop).
 */
export default function AiBudgetBanner({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const status = useQuery({
    queryKey: aiBudgetKey(workspaceId),
    queryFn: () => getAiBudgetStatus(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
  const data = status.data;
  if (!data?.warning || data.usedPercent === null) return null;
  const reached = data.usedPercent >= 100;
  return (
    <Alert variant={reached ? "error" : "warning"} className={className}>
      <TriangleAlert aria-hidden />
      <AlertTitle>
        {reached
          ? t("ai:budget.reachedTitle")
          : t("ai:budget.warningTitle", { percent: data.usedPercent })}
      </AlertTitle>
      <AlertDescription>
        {data.usedMicros !== null && data.monthlyCapMicros !== null
          ? t("ai:budget.amounts", {
              used: formatCostMicros(data.usedMicros, i18n.language),
              cap: formatCostMicros(data.monthlyCapMicros, i18n.language),
            })
          : null}{" "}
        {reached ? t("ai:budget.reachedHint") : t("ai:budget.warningHint")}
      </AlertDescription>
    </Alert>
  );
}
