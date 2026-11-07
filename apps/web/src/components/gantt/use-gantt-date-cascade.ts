import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isClosedTone,
  type ToneInfo,
  toneOf,
} from "@/components/calendar/status-tone";
import { useApplyDateCascade } from "@/hooks/mutations/task/use-apply-date-cascade";
import { shiftTaskDates } from "@/lib/schedule-dates";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import { type CascadeTask, planDateCascade } from "./date-cascade";
import type { BarSpan, DependencyRelation } from "./dependency-lines";
import { taskScheduleSpan } from "./timeline";

export type CascadePreviewRow = {
  task: Task;
  days: number;
  from: BarSpan;
  to: BarSpan;
};

type PlanOptions = {
  /** The root's dates, when the board cache may not hold them yet. */
  rootSpan?: BarSpan;
  /** A relation just made, which the loaded list may not hold yet. */
  relation?: DependencyRelation;
};

type Options = {
  projectId: string;
  /** Every loaded task: a filter must not hide what a move would push. */
  tasks: readonly Task[];
  tones: ReadonlyMap<string, ToneInfo>;
  relations: readonly DependencyRelation[];
};

/**
 * The opt-in date cascade: when a move or a new link leaves dependents behind
 * it offers to shift them, shows exactly what would change, and moves nothing
 * until that preview is confirmed. Closed tasks keep their dates.
 */
export function useGanttDateCascade({
  projectId,
  tasks,
  tones,
  relations,
}: Options) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<CascadePreviewRow[] | null>(null);
  const applyCascade = useApplyDateCascade(projectId);

  // A toast's action runs later, and must plan from what is true by then.
  const latest = useRef({ tasks, tones, relations });
  latest.current = { tasks, tones, relations };

  const plan = useCallback(
    (rootId: string, { rootSpan, relation }: PlanOptions = {}) => {
      const current = latest.current;
      const byId = new Map<string, CascadeTask & { task: Task }>();
      for (const task of current.tasks) {
        const span =
          task.id === rootId && rootSpan ? rootSpan : taskScheduleSpan(task);
        if (!span) continue;
        byId.set(task.id, {
          task,
          span,
          locked: isClosedTone(toneOf(task.status, current.tones).tone),
        });
      }
      return planDateCascade(
        rootId,
        relation ? [...current.relations, relation] : current.relations,
        byId,
      ).flatMap((move): CascadePreviewRow[] => {
        const entry = byId.get(move.taskId);
        return entry
          ? [
              {
                task: entry.task,
                days: move.days,
                from: entry.span,
                to: move.span,
              },
            ]
          : [];
      });
    },
    [],
  );

  /** Opens the preview for a task's dependents, or says none can move. */
  const review = useCallback(
    (rootId: string, options?: PlanOptions) => {
      const rows = plan(rootId, options);
      if (rows.length > 0) setPreview(rows);
      else toast.info(t("tasks:gantt.cascade.nothingToMove"));
    },
    [plan, t],
  );

  /** Says dependents were left behind, and offers the preview. Moves nothing. */
  const offer = useCallback(
    (rootId: string, options?: PlanOptions) => {
      const count = plan(rootId, options).length;
      if (count === 0) return;
      toast.warning(t("tasks:gantt.cascade.offer", { count }), {
        action: {
          label: t("tasks:gantt.cascade.reviewAction"),
          onClick: () => review(rootId, { relation: options?.relation }),
        },
      });
    },
    [plan, review, t],
  );

  const confirm = useCallback(async () => {
    if (!preview) return;
    const { moved, failed } = await applyCascade.mutateAsync(
      preview.map(({ task, days }) => ({
        task,
        ...shiftTaskDates(task, days),
      })),
    );
    setPreview(null);
    if (failed > 0) {
      toast.error(
        t("tasks:gantt.cascade.partial", { moved, total: moved + failed }),
      );
    } else {
      toast.success(t("tasks:gantt.cascade.moved", { count: moved }));
    }
  }, [applyCascade, preview, t]);

  return {
    preview,
    isApplying: applyCascade.isPending,
    review,
    offer,
    confirm,
    cancel: useCallback(() => setPreview(null), []),
  };
}
