import { isSameDay } from "date-fns";
import { ArrowRight } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatDateShort } from "@/lib/format";
import type { BarSpan } from "./dependency-lines";
import type { CascadePreviewRow } from "./use-gantt-date-cascade";

function spanLabel({ scheduleStart, scheduleEnd }: BarSpan): string {
  return isSameDay(scheduleStart, scheduleEnd)
    ? formatDateShort(scheduleEnd)
    : `${formatDateShort(scheduleStart)} – ${formatDateShort(scheduleEnd)}`;
}

type GanttCascadeDialogProps = {
  rows: readonly CascadePreviewRow[] | null;
  projectSlug?: string;
  isApplying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Exactly which tasks a date cascade would move, before it moves any. */
export default function GanttCascadeDialog({
  rows,
  projectSlug,
  isApplying,
  onCancel,
  onConfirm,
}: GanttCascadeDialogProps): JSX.Element {
  const { t } = useTranslation();
  const count = rows?.length ?? 0;

  return (
    <AlertDialog
      open={rows !== null}
      onOpenChange={(open) => {
        if (!open && !isApplying) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tasks:gantt.cascade.title", { count })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:gantt.cascade.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          data-testid="gantt-cascade-preview"
          className="mx-6 mb-4 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {rows?.map(({ task, from, to }) => (
            <li key={task.id} className="px-3 py-2 text-xs">
              <p className="flex min-w-0 items-baseline gap-2">
                {projectSlug && task.number != null ? (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {projectSlug}-{task.number}
                  </span>
                ) : null}
                <span className="truncate font-medium text-foreground">
                  {task.title}
                </span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 tabular-nums text-muted-foreground">
                {spanLabel(from)}
                <ArrowRight aria-hidden="true" className="size-3" />
                <span className="sr-only">{t("tasks:gantt.cascade.to")}</span>
                <span className="text-foreground">{spanLabel(to)}</span>
              </p>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <Button variant="outline" disabled={isApplying} onClick={onCancel}>
            {t("tasks:gantt.cascade.cancel")}
          </Button>
          <Button loading={isApplying} onClick={onConfirm}>
            {t("tasks:gantt.cascade.confirm", { count })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
