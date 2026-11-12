import { Link } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AiContentLabel } from "@/components/ai/ai-content-label";
import WidgetSection, {
  WidgetEmpty,
  WidgetError,
} from "@/components/home/widget-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useLatestProjectUpdates } from "@/hooks/queries/project-update/use-project-updates";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import HealthBadge from "./health-badge";

type ProjectUpdatesWidgetProps = {
  workspaceId: string;
  onOpenTask?: (taskId: string, projectId: string) => void;
};

/**
 * Home: the latest status update of each project you can see that has
 * Updates on (opt-in widget).
 */
export default function ProjectUpdatesWidget({
  workspaceId,
}: ProjectUpdatesWidgetProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } =
    useLatestProjectUpdates(workspaceId);

  return (
    <WidgetSection
      title={t("projectUpdates:widget.title")}
      icon={Megaphone}
      tone="var(--area-work)"
    >
      {isPending ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : isError || !data ? (
        <WidgetError
          message={t("projectUpdates:widget.error")}
          retryLabel={t("projectUpdates:retry")}
          onRetry={() => refetch()}
        />
      ) : data.updates.length === 0 ? (
        <WidgetEmpty>{t("projectUpdates:widget.empty")}</WidgetEmpty>
      ) : (
        <ul className="divide-y">
          {data.updates.map((update) => (
            <li key={update.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/dashboard/workspace/$workspaceId/project/$projectId/updates"
                  params={{ workspaceId, projectId: update.projectId }}
                  className="min-w-0 flex-1 truncate font-medium text-sm underline-offset-2 hover:underline focus-visible:underline"
                >
                  {update.projectName}
                </Link>
                <AiContentLabel provenance={update.aiProvenance} />
                <HealthBadge health={update.health} />
              </div>
              <p className="line-clamp-2 text-muted-foreground text-sm">
                {update.summary}
              </p>
              <p className="text-muted-foreground text-xs">
                {update.author?.name ?? t("projectUpdates:deletedUser")} ·{" "}
                <time
                  dateTime={String(update.createdAt)}
                  title={formatDateTime(update.createdAt)}
                >
                  {formatRelativeTime(update.createdAt)}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </WidgetSection>
  );
}
