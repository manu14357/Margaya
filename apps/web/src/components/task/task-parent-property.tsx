import { CornerLeftUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { cn } from "@/lib/cn";
import { formatTaskKey } from "@/lib/task-key";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { oldestParent } from "@/lib/task-relations";
import TaskParentPopover from "./task-parent-popover";

/**
 * The "Parent" property of the task sidebar: a full-width row in the
 * desktop stack, a chip in the compact and mobile rows.
 */
export default function TaskParentProperty({
  task,
  layout,
}: TaskPropertySlotProps["sidebar"]) {
  const { t } = useTranslation();
  const { data: relations = [] } = useGetTaskRelations(task.id);
  const parent = oldestParent(relations, task.id)?.sourceTask ?? null;
  const key = parent ? formatTaskKey(parent.projectSlug, parent.number) : null;
  const stack = layout === "stack";

  return (
    <TaskParentPopover task={task}>
      <Button
        variant="ghost"
        size="sm"
        title={
          parent
            ? t("tasks:parent.tooltip", { key, title: parent.title })
            : t("tasks:parent.label")
        }
        className={cn("h-7 justify-start gap-1.5 px-1.5", stack && "w-full")}
      >
        <CornerLeftUp className="size-3.5 text-muted-foreground" />
        {parent ? (
          <>
            <span className="shrink-0 font-mono text-muted-foreground text-xs">
              {key}
            </span>
            {stack && (
              <span className="min-w-0 truncate font-semibold text-xs">
                {parent.title}
              </span>
            )}
          </>
        ) : (
          <span className="font-semibold text-muted-foreground text-xs">
            {stack ? t("tasks:parent.add") : t("tasks:parent.chip")}
          </span>
        )}
      </Button>
    </TaskParentPopover>
  );
}
