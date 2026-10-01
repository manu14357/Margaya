import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { analyticsKeys } from "@/lib/analytics/scope-key";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";

/**
 * Refetches every analytics query of the scope. It spins while any of them
 * loads, and its tooltip says how old the oldest shown number is.
 */
export default function AnalyticsRefreshButton({
  workspaceId,
  scopeKey,
}: {
  workspaceId: string;
  scopeKey: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = analyticsKeys.scope(workspaceId, scopeKey);
  const fetching = useIsFetching({ queryKey }) > 0;

  const updatedTimes = queryClient
    .getQueryCache()
    .findAll({ queryKey, type: "active" })
    .map((query) => query.state.dataUpdatedAt)
    .filter((time) => time > 0);
  const oldest = updatedTimes.length ? Math.min(...updatedTimes) : null;
  const label = t("analytics:header.refresh");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-busy={fetching || undefined}
            onClick={() => void queryClient.invalidateQueries({ queryKey })}
          />
        }
      >
        <RefreshCw
          className={cn("size-3.5", fetching && "motion-safe:animate-spin")}
        />
      </TooltipTrigger>
      <TooltipContent>
        {oldest
          ? t("analytics:header.updatedAt", {
              time: formatRelativeTime(oldest),
            })
          : label}
      </TooltipContent>
    </Tooltip>
  );
}
