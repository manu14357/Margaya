import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import Activity from "@/components/activity";
import { taskRefLabel } from "@/components/activity/task-detail-activity";
import { isCommentActivity } from "@/components/activity/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline } from "@/components/ui/timeline";
import type { MyActivityItem } from "@/fetchers/activity/get-my-activity";
import useMyActivity from "@/hooks/queries/activity/use-my-activity";
import { formatRelativeTime } from "@/lib/format";

const SNIPPET_LIMIT = 120;

/** A comment's first line, shortened: the list stays one line per entry. */
function commentSnippet(content: string | null) {
  // Comments store @mentions as <margaya-mention label="…"> tags.
  const text = (content ?? "")
    .replace(
      /<margaya-mention[^>]*\blabel="([^"]*)"[^>]*>(?:<\/margaya-mention>)?/gi,
      "@$1",
    )
    .replace(/<[^>]+>/g, "");
  const firstLine = text.trim().split("\n")[0] ?? "";
  return firstLine.length > SNIPPET_LIMIT
    ? `${firstLine.slice(0, SNIPPET_LIMIT)}…`
    : firstLine;
}

function Entry({
  item,
  workspaceId,
}: {
  item: MyActivityItem;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-0.5 border-border/40 border-b py-2 last:border-b-0">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
        params={{
          workspaceId,
          projectId: item.task.projectId,
          taskId: item.task.id,
        }}
        className="truncate font-medium text-sm hover:underline"
      >
        {taskRefLabel(item.task)}
      </Link>
      {isCommentActivity(item) ? (
        <p className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
          <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0">{t("myWork:activity.commented")}</span>
          <span className="truncate text-foreground">
            {commentSnippet(item.content)}
          </span>
          <span className="shrink-0 text-xs">
            {formatRelativeTime(item.createdAt)}
          </span>
        </p>
      ) : (
        <Activity activity={item} step={1} />
      )}
    </li>
  );
}

/**
 * Latest activity, 10 at a time: the caller's own ("Your work"), or a
 * member's when `userId` is given (their profile).
 */
export default function MyWorkActivity({
  workspaceId,
  userId,
  emptyLabel,
}: {
  workspaceId: string;
  userId?: string;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const query = useMyActivity(workspaceId, userId);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isLoading) {
    return (
      <Card className="gap-2 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card className="flex-row items-center justify-between gap-3 p-4">
        <span className="text-muted-foreground text-sm">
          {t("myWork:loadError")}
        </span>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          {t("myWork:retry")}
        </Button>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-center text-muted-foreground text-sm">
          {emptyLabel ?? t("myWork:empty.activity")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-1 px-4 py-2">
      <Timeline>
        <ul aria-label={t("myWork:workload.recentActivity")}>
          {items.map((item) => (
            <Entry key={item.id} item={item} workspaceId={workspaceId} />
          ))}
        </ul>
      </Timeline>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {t("myWork:activity.showMore")}
        </Button>
      )}
    </Card>
  );
}
