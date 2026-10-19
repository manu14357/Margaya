import { format } from "date-fns";
import { type ComponentProps, useRef } from "react";
import { useTranslation } from "react-i18next";
import CaptureBar from "@/components/task-draft/capture-bar";
import { Popover, PopoverPopup } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";

export type DayCaptureTarget = { day: Date; anchor: HTMLElement };

type DayCapturePopoverProps = {
  projectId: string;
  workspaceId: string;
  /** The day whose "+" was pressed; null while closed. */
  target: DayCaptureTarget | null;
  /** Where new tasks land: the project's entry column. */
  column: { slug: string; name: string };
  onClose: () => void;
  /** Ctrl Enter: the full composer, with what was typed. */
  onOpenComposer: NonNullable<
    ComponentProps<typeof CaptureBar>["onOpenComposer"]
  >;
};

/**
 * The calendar's quick add: a one-line capture field under a day's "+",
 * creating tasks due that day. Enter keeps it open for the next task;
 * Escape or a click outside closes it.
 */
export default function DayCapturePopover({
  projectId,
  workspaceId,
  target,
  column,
  onClose,
  onOpenComposer,
}: DayCapturePopoverProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <Popover
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverPopup
        anchor={target?.anchor}
        side="bottom"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)]"
        initialFocus={() =>
          containerRef.current?.querySelector("input") ?? true
        }
      >
        <div ref={containerRef} className="py-1">
          {target ? (
            <CaptureBar
              key={target.day.toISOString()}
              projectId={projectId}
              workspaceId={workspaceId}
              prefill={{
                status: column.slug,
                targetName: column.name,
                dueDate: format(target.day, "yyyy-MM-dd"),
              }}
              inputLabel={t("tasks:capture.dueOn", {
                date: formatDate(target.day, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                }),
              })}
              autoFocus
              onOpenComposer={(handoff) => {
                onClose();
                onOpenComposer(handoff);
              }}
              onDismiss={onClose}
              className="border-transparent bg-transparent shadow-none"
            />
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
