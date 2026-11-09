import { Link } from "@tanstack/react-router";
import { Sparkles, Sunrise } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-ai-locale";
import WidgetSection, {
  WidgetEmpty,
  WidgetError,
} from "@/components/home/widget-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  citationsOf,
  type InsightCitation,
  type MyBrief,
  streamMyBriefSummary,
} from "@/fetchers/insight/insight";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useMyBrief } from "@/hooks/queries/insight/use-insight";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { linkCitations } from "@/lib/ai/brief-citations";

// The Markdown renderer loads with the first summary, not with Home.
const loadAiMarkdown = () => import("@/components/ai/ai-markdown");
const AiMarkdown = lazy(loadAiMarkdown);

type MyBriefWidgetProps = {
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
};

type BriefTask = MyBrief["dueToday"]["items"][number];

/**
 * Home: My brief (#18), an opt-in daily note computed from your own visible
 * work. With AI on, "Summarize" condenses it into a few sentences.
 */
export default function MyBriefWidget({
  workspaceId,
  onOpenTask,
}: MyBriefWidgetProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useMyBrief(workspaceId);
  const summary = useBriefSummary(workspaceId);
  const empty =
    data &&
    data.overdue.total +
      data.dueToday.total +
      data.blocked.total +
      data.mentions.total +
      data.following.total ===
      0;

  return (
    <WidgetSection
      title={t("insight:myBrief.title")}
      icon={Sunrise}
      tone="var(--area-home)"
      actions={data && !empty ? <SummaryButton summary={summary} /> : null}
    >
      {isPending ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : isError || !data ? (
        <WidgetError
          message={t("insight:myBrief.error")}
          retryLabel={t("insight:retry")}
          onRetry={() => refetch()}
        />
      ) : empty ? (
        <WidgetEmpty>{t("insight:myBrief.empty")}</WidgetEmpty>
      ) : (
        <div className="space-y-3">
          <SummaryOutput summary={summary} />
          <TaskGroup
            title={t("insight:myBrief.overdue", { total: data.overdue.total })}
            total={data.overdue.total}
            shown={data.overdue.items.length}
          >
            {data.overdue.items.map((task) => (
              <TaskRow key={task.id} task={task} onOpenTask={onOpenTask} />
            ))}
          </TaskGroup>
          <TaskGroup
            title={t("insight:myBrief.dueToday", {
              total: data.dueToday.total,
            })}
            total={data.dueToday.total}
            shown={data.dueToday.items.length}
          >
            {data.dueToday.items.map((task) => (
              <TaskRow key={task.id} task={task} onOpenTask={onOpenTask} />
            ))}
          </TaskGroup>
          <TaskGroup
            title={t("insight:myBrief.blocked", { total: data.blocked.total })}
            total={data.blocked.total}
            shown={data.blocked.items.length}
          >
            {data.blocked.items.map((entry) => (
              <TaskRow
                key={entry.task.id}
                task={entry.task}
                onOpenTask={onOpenTask}
                detail={t("insight:myBrief.waitingOn", {
                  keys: [
                    ...entry.blockers.map((blocker) => blocker.key),
                    ...(entry.hiddenBlockers > 0
                      ? [
                          t("insight:myBrief.hiddenBlockers", {
                            count: entry.hiddenBlockers,
                          }),
                        ]
                      : []),
                  ].join(", "),
                })}
              />
            ))}
          </TaskGroup>
          <TaskGroup
            title={t("insight:myBrief.mentions", {
              total: data.mentions.total,
            })}
            total={data.mentions.total}
            shown={data.mentions.items.length}
          >
            {data.mentions.items.map((mention) => (
              <li key={mention.id} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {mention.taskId && mention.projectId ? (
                    <button
                      type="button"
                      className="truncate text-left hover:underline"
                      onClick={() =>
                        onOpenTask(
                          mention.taskId as string,
                          mention.projectId as string,
                        )
                      }
                    >
                      {mention.key ? `${mention.key} ` : ""}
                      {mention.title}
                    </button>
                  ) : mention.pageId && mention.projectId ? (
                    <Link
                      to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
                      params={{
                        workspaceId,
                        projectId: mention.projectId,
                        pageId: mention.pageId,
                      }}
                      className="hover:underline"
                    >
                      {mention.title}
                    </Link>
                  ) : (
                    mention.title
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {mention.actorName
                    ? t("insight:myBrief.mentionedBy", {
                        name: mention.actorName,
                      })
                    : t("insight:myBrief.mentioned")}
                </span>
              </li>
            ))}
          </TaskGroup>
          <TaskGroup
            title={t("insight:myBrief.following", {
              total: data.following.total,
            })}
            total={data.following.total}
            shown={data.following.items.length}
          >
            {data.following.items.map((entry) => (
              <TaskRow
                key={entry.task.id}
                task={entry.task}
                onOpenTask={onOpenTask}
                detail={entry.kinds
                  .map((kind) => t(`insight:myBrief.kinds.${kind}`))
                  .join(", ")}
              />
            ))}
          </TaskGroup>
        </div>
      )}
    </WidgetSection>
  );
}

function TaskGroup({
  title,
  total,
  shown,
  children,
}: {
  title: string;
  total: number;
  shown: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (total === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
      <ul className="space-y-1 text-sm">{children}</ul>
      {total > shown && (
        <p className="text-muted-foreground text-xs">
          {t("insight:myBrief.more", { count: total - shown })}
        </p>
      )}
    </div>
  );
}

function TaskRow({
  task,
  detail,
  onOpenTask,
}: {
  task: BriefTask;
  detail?: string;
  onOpenTask: (taskId: string, projectId: string) => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
        onClick={() => onOpenTask(task.id, task.projectId)}
      >
        <span className="shrink-0 font-mono text-muted-foreground text-xs">
          {task.key}
        </span>
        <span className="truncate">{task.title}</span>
      </button>
      <span className="max-w-[45%] shrink-0 truncate text-muted-foreground text-xs">
        {detail ?? task.projectName}
      </span>
    </li>
  );
}

/** The AI summary of the brief; hidden while AI is off. */
function useBriefSummary(workspaceId: string) {
  const locale = useAiLocale();
  const { available } = useAiAvailability();
  const stream = useAiTextStream();
  const [citations, setCitations] = useState<InsightCitation[]>([]);
  const summarize = () => {
    // Fetched while the summary is written; a failure shows when it renders.
    loadAiMarkdown().catch(() => {});
    void stream.start((handlers) =>
      streamMyBriefSummary(
        { workspaceId, ...(locale ? { locale } : {}) },
        { ...handlers, onMeta: (meta) => setCitations(citationsOf(meta)) },
      ),
    );
  };
  return { available, stream, citations, summarize };
}

type Summary = ReturnType<typeof useBriefSummary>;

function SummaryButton({ summary }: { summary: Summary }) {
  const { t } = useTranslation();
  if (!summary.available) return null;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      className="gap-1"
      disabled={summary.stream.status === "streaming"}
      onClick={summary.summarize}
    >
      <Sparkles className="size-3 text-muted-foreground" />
      {t("insight:myBrief.summarize")}
    </Button>
  );
}

function SummaryOutput({ summary }: { summary: Summary }) {
  const { t } = useTranslation();
  const { stream, citations } = summary;
  if (!summary.available || stream.status === "idle") return null;
  const writing = (
    <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
      <Spinner className="size-3.5" />
      {t("insight:writing")}
    </span>
  );
  return (
    <div
      aria-live="polite"
      aria-busy={stream.status === "streaming"}
      className="rounded-md border bg-muted/30 px-2.5 py-2"
    >
      {stream.status === "error" ? (
        <p role="alert" className="text-destructive-foreground text-sm">
          {t(stream.errorKey ?? "ai:errors.unknown")}
        </p>
      ) : stream.text ? (
        <Suspense fallback={writing}>
          <AiMarkdown text={linkCitations(stream.text, citations)} />
        </Suspense>
      ) : (
        writing
      )}
    </div>
  );
}
