import { Link } from "@tanstack/react-router";
import { History, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  citationsOf,
  type InsightCitation,
  streamEstimateExplanation,
} from "@/fetchers/insight/insight";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useEstimateSuggestion } from "@/hooks/queries/insight/use-insight";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { linkCitations } from "@/lib/ai/brief-citations";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { Estimate } from "@/types/estimate";

type EstimateSuggestionProps = {
  task: { id: string; projectId: string };
  estimate: Pick<Estimate, "type" | "points">;
  /** The picker is open: only then is the suggestion fetched. */
  open: boolean;
  currentPointId: string | null;
  onPick: (pointId: string) => void;
};

/**
 * Calibrated estimates (#9): "Similar tasks were usually 3 points", from
 * the team's finished work, above the estimate options. Using it is one
 * click; ignoring it costs nothing. With AI on, "Why?" explains it.
 */
export default function EstimateSuggestion({
  task,
  estimate,
  open,
  currentPointId,
  onPick,
}: EstimateSuggestionProps) {
  const { t } = useTranslation();
  const { data } = useEstimateSuggestion(task.projectId, task.id, open);
  const suggestion = data?.status === "ok" ? data.suggestion : null;
  const point = suggestion
    ? estimate.points.find((candidate) => candidate.id === suggestion.pointId)
    : undefined;
  if (!data || !suggestion || !point) return null;

  const value = formatEstimateValue(estimate.type, point.value, {
    withUnit: true,
    t,
  });
  const time = data.cycleTime;
  return (
    <div className="space-y-1.5 border-b bg-muted/40 px-2.5 py-2 text-xs">
      <div className="flex items-start gap-1.5">
        <History
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {t("insight:estimate.usually", { value })}
          </p>
          <p className="text-muted-foreground">
            {time
              ? t("insight:estimate.took", {
                  count: suggestion.matches,
                  min: time.min,
                  max: time.max,
                  median: time.median,
                })
              : t("insight:estimate.basedOn", { count: suggestion.matches })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {currentPointId !== point.id && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onPick(point.id)}
          >
            {t("insight:estimate.use", { value })}
          </Button>
        )}
        <ExplainButton task={task} />
      </div>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none">
          {t("insight:estimate.similar")}
        </summary>
        <SimilarList similar={data.similar} estimate={estimate} />
      </details>
    </div>
  );
}

function SimilarList({
  similar,
  estimate,
}: {
  similar: Array<{
    id: string;
    key: string;
    title: string;
    projectId: string;
    value: string;
    cycleTimeDays: number | null;
  }>;
  estimate: Pick<Estimate, "type" | "points">;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  return (
    <ul className="mt-1 space-y-0.5">
      {similar.map((task) => (
        <li key={task.id} className="flex items-center gap-1.5">
          {workspace ? (
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
              params={{
                workspaceId: workspace.id,
                projectId: task.projectId,
                taskId: task.id,
              }}
              className="shrink-0 font-mono hover:underline"
            >
              {task.key}
            </Link>
          ) : (
            <span className="shrink-0 font-mono">{task.key}</span>
          )}
          <span className="min-w-0 flex-1 truncate" title={task.title}>
            {task.title}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatEstimateValue(estimate.type, task.value, { t })}
            {task.cycleTimeDays !== null &&
              ` · ${t("insight:days", { count: task.cycleTimeDays })}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Why?": a short AI explanation of the suggestion. Hidden while AI is off. */
function ExplainButton({ task }: { task: { id: string; projectId: string } }) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(task.projectId);
  const { data: workspace } = useActiveWorkspace();
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const [citations, setCitations] = useState<InsightCitation[]>([]);
  if (!available || !workspace) return null;

  const explain = () =>
    void stream.start((handlers) =>
      streamEstimateExplanation(
        {
          workspaceId: workspace.id,
          projectId: task.projectId,
          taskId: task.id,
          ...(locale ? { locale } : {}),
        },
        { ...handlers, onMeta: (meta) => setCitations(citationsOf(meta)) },
      ),
    );

  return (
    <>
      {stream.status === "idle" && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="gap-1"
          onClick={explain}
        >
          <Sparkles className="size-3 text-muted-foreground" />
          {t("insight:estimate.why")}
        </Button>
      )}
      {stream.status !== "idle" && (
        <div className="w-full" aria-live="polite">
          {stream.status === "error" ? (
            <p role="alert" className="text-destructive-foreground">
              {t(stream.errorKey ?? "ai:errors.unknown")}
            </p>
          ) : stream.text ? (
            <AiMarkdown
              className="text-xs"
              text={linkCitations(stream.text, citations)}
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Spinner className="size-3" />
              {t("insight:writing")}
            </span>
          )}
        </div>
      )}
    </>
  );
}
