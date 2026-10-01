import { GripVertical, Trash2 } from "lucide-react";
import { type DragEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export type PointRowDrag = {
  isDragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: (event: DragEvent<HTMLDivElement>) => void;
};

type EstimatePointRowProps = {
  value: string;
  onChange: (text: string) => void;
  /** Blur or Enter: save (settings) or tidy up (create dialog). */
  onCommit: () => void;
  /** The value's text as saved, for labels ("Delete 5"). */
  label: string;
  error: string | null;
  /** Settings show how many tasks use each value. */
  taskCount?: number;
  canEdit: boolean;
  saving?: boolean;
  /** At the minimum of 2 values the delete button gives way to a hint. */
  canDelete: boolean;
  onDelete: () => void;
  /** Categories only: the row can be dragged to reorder. */
  drag?: PointRowDrag | null;
};

/**
 * One value of an estimate system, in the column editor's row style: a grip
 * (categories), an inline input that saves on blur or Enter, the task count
 * and a delete button. Errors show under the row.
 */
export default function EstimatePointRow({
  value,
  onChange,
  onCommit,
  label,
  error,
  taskCount,
  canEdit,
  saving = false,
  canDelete,
  onDelete,
  drag,
}: EstimatePointRowProps) {
  const { t } = useTranslation();
  // Only the grip starts a drag, so selecting text in the input still works.
  const [armed, setArmed] = useState(false);
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;

  return (
    <li className="space-y-1">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target of a drag-to-reorder list, like the column editor rows */}
      <div
        draggable={Boolean(drag) && armed && canEdit}
        onDragStart={drag?.onDragStart}
        onDragOver={drag?.onDragOver}
        onDrop={drag?.onDrop}
        onDragEnd={(event) => {
          setArmed(false);
          drag?.onDragEnd(event);
        }}
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-sidebar p-2 transition-colors hover:bg-sidebar-accent/50",
          drag?.isDragging && "opacity-60",
          error && "border-destructive/50",
        )}
      >
        {drag && canEdit && (
          <span
            role="img"
            aria-label={t("settings:projectEstimates.values.dragHandle")}
            title={t("settings:projectEstimates.values.dragHandle")}
            onPointerDown={() => setArmed(true)}
            onPointerUp={() => setArmed(false)}
            className="cursor-grab text-muted-foreground"
          >
            <GripVertical className="size-4 shrink-0" />
          </span>
        )}
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          disabled={!canEdit || saving}
          aria-label={t("settings:projectEstimates.values.editAria", {
            value: label,
          })}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="h-8 flex-1 text-sm"
        />
        {taskCount !== undefined && (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {t("settings:projectEstimates.values.taskCount", {
              count: taskCount,
            })}
          </span>
        )}
        <div className="flex w-7 shrink-0 justify-center">
          {saving ? (
            <Spinner className="size-3.5 text-muted-foreground" />
          ) : !canEdit ? null : canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              aria-label={t("settings:projectEstimates.values.deleteAria", {
                value: label,
              })}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-disabled="true"
                      className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40"
                      aria-label={t(
                        "settings:projectEstimates.values.minTooltip",
                      )}
                    />
                  }
                >
                  <Trash2 className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings:projectEstimates.values.minTooltip")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      {error && (
        <p id={errorId} className="px-1 text-destructive text-xs">
          {error}
        </p>
      )}
    </li>
  );
}
