import type { JSX, RefObject } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent } from "@/components/ui/popover";
import useDeleteTaskRelation from "@/hooks/mutations/task-relation/use-delete-task-relation";
import { toast } from "@/lib/toast";
import type { DependencyLine } from "./dependency-lines";

const SENTENCE_KEYS: Record<DependencyLine["type"], string> = {
  blocks: "tasks:gantt.link.blocks",
  start_before: "tasks:gantt.link.startBefore",
  finish_before: "tasks:gantt.link.finishBefore",
};

export type SelectedLink = {
  line: DependencyLine;
  /** Where the line was clicked, from the top left of the chart's rows. */
  x: number;
  y: number;
};

type Box = { top: number; bottom: number };

/**
 * The popover's anchor: a zero-width strip at the clicked x that runs from
 * the top of the higher linked row to the bottom of the lower one. Placed
 * below it, or flipped above, the popover covers neither bar.
 */
export function linkAnchorRect(
  point: { x: number; y: number },
  rows: ReadonlyArray<Box | null | undefined>,
): DOMRect {
  const boxes = rows.filter((row): row is Box => Boolean(row));
  const top = Math.min(point.y, ...boxes.map((row) => row.top));
  const bottom = Math.max(point.y, ...boxes.map((row) => row.bottom));
  return {
    x: point.x,
    y: top,
    left: point.x,
    right: point.x,
    top,
    bottom,
    width: 0,
    height: bottom - top,
    toJSON: () => null,
  } as DOMRect;
}

type GanttLinkPopoverProps = {
  /** The clicked line; null while closed. */
  selected: SelectedLink | null;
  /** The chart's rows, which hold each task's `data-gantt-row`. */
  rowsRef: RefObject<HTMLElement | null>;
  titleOf: (taskId: string) => string;
  onClose: () => void;
  onReviewDates: (sourceTaskId: string) => void;
};

/**
 * What a line on the chart says, and the way to remove it. It stays mounted
 * and opens on a selection: a popover rendered already open skips its
 * entrance, so it would appear without the fade, at the corner where it
 * starts out before it is placed.
 */
export default function GanttLinkPopover({
  selected,
  rowsRef,
  titleOf,
  onClose,
  onReviewDates,
}: GanttLinkPopoverProps): JSX.Element {
  // The last selection stays shown while the popover fades out.
  const [shown, setShown] = useState(selected);
  if (selected && selected !== shown) setShown(selected);

  const anchor = useMemo(() => {
    if (!shown) return undefined;
    const { line, x, y } = shown;
    const rowRect = (taskId: string) =>
      rowsRef.current
        ?.querySelector(`[data-gantt-row="${CSS.escape(taskId)}"]`)
        ?.getBoundingClientRect();
    return {
      // Its scrolling ancestors tell the popover when the chart scrolls.
      contextElement: rowsRef.current ?? undefined,
      // Read live, so the popover moves with the chart instead of staying
      // where the click was.
      getBoundingClientRect: () => {
        const rows = rowsRef.current?.getBoundingClientRect();
        return linkAnchorRect(
          { x: (rows?.left ?? 0) + x, y: (rows?.top ?? 0) + y },
          [rowRect(line.sourceTaskId), rowRect(line.targetTaskId)],
        );
      },
    };
  }, [shown, rowsRef]);

  return (
    <Popover
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className="w-72 max-w-[calc(100vw-1rem)]"
        data-testid="gantt-link-popover"
      >
        {shown ? (
          <LinkDetails
            line={shown.line}
            sourceTitle={titleOf(shown.line.sourceTaskId)}
            targetTitle={titleOf(shown.line.targetTaskId)}
            onClose={onClose}
            onReviewDates={onReviewDates}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function LinkDetails({
  line,
  sourceTitle,
  targetTitle,
  onClose,
  onReviewDates,
}: {
  line: DependencyLine;
  sourceTitle: string;
  targetTitle: string;
  onClose: () => void;
  onReviewDates: (sourceTaskId: string) => void;
}) {
  const { t } = useTranslation();
  const deleteRelation = useDeleteTaskRelation(line.sourceTaskId);
  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="text-foreground text-xs">
        {t(SENTENCE_KEYS[line.type], {
          source: sourceTitle,
          target: targetTitle,
        })}
      </p>
      {line.conflict ? (
        <p className="text-(color:--dependency-conflict) text-xs">
          {t("tasks:gantt.link.conflict")}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-1.5">
        {line.conflict ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onClose();
              onReviewDates(line.sourceTaskId);
            }}
          >
            {t("tasks:gantt.cascade.reviewAction")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            // Closing unmounts this, and `mutate` drops its callbacks then.
            deleteRelation
              .mutateAsync(line.id)
              .catch(() => toast.error(t("tasks:relations.removeError")));
            onClose();
          }}
        >
          {t("tasks:relations.removeRelation")}
        </Button>
      </div>
    </div>
  );
}
