import type { SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Whether the bulk toolbar would offer this person anything at all. */
export function useCanBulkSelect() {
  const { canUpdateTasks, canDeleteTasks, canAssignTasks, canUpdateLabels } =
    useWorkspacePermission();
  return (
    canUpdateTasks() ||
    canDeleteTasks() ||
    canAssignTasks() ||
    canUpdateLabels()
  );
}

/**
 * A task's bulk selection control. Its surface (a card or row) must carry
 * `group/selectable`: the control stays hidden until that surface is hovered
 * or holds focus, or anything is selected, and it always shows on touch.
 *
 * It keeps its own pointer and activation keys away from the surface, which
 * would otherwise open the task or start a drag. The hidden input Base UI
 * clicks is a sibling of the control, so the wrapper has to stop that too.
 */
export function SelectionCheckbox({
  title,
  checked,
  selectionActive,
  onToggle,
  className,
}: {
  /** The task's title, which names the control for assistive technology. */
  title: string;
  checked: boolean;
  /** True while anything is selected, so every control stays in view. */
  selectionActive: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only stops propagation; the checkbox inside handles input
    <span
      data-selection-control
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onTouchStart={stop}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") stop(event);
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-opacity duration-150 group-focus-within/selectable:opacity-100 group-hover/selectable:opacity-100 pointer-coarse:opacity-100",
        checked || selectionActive ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle()}
        aria-label={t("tasks:bulk.selectTask", { title })}
        className="cursor-pointer pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
      />
    </span>
  );
}
