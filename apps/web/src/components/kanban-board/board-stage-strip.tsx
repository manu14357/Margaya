import { useTranslation } from "react-i18next";
import { getColumnIcon } from "@/lib/column";
import type { ProjectWithTasks } from "@/types/project";

/**
 * Phones page through the board one column at a time (DESIGN-SYSTEM §9);
 * this strip of stage chips jumps to a column.
 */
export function BoardStageStrip({
  columns,
}: {
  columns: ProjectWithTasks["columns"];
}) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("tasks:kanban.stages")}
      className="flex shrink-0 gap-1 overflow-x-auto border-border/60 border-b px-2 py-1.5 [scrollbar-width:none] pointer-coarse:py-2.5 md:hidden"
    >
      {columns.map((column) => (
        <button
          key={column.id}
          type="button"
          className="relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[9px]"
          onClick={() =>
            document
              .getElementById(`board-column-${column.id}`)
              ?.scrollIntoView({
                behavior: "smooth",
                inline: "start",
                block: "nearest",
              })
          }
        >
          <span className="flex text-muted-foreground">
            {getColumnIcon(
              column.id,
              column.isFinal,
              column.icon,
              column.group,
              { neutral: true },
            )}
          </span>
          {column.name}
          <span className="text-muted-foreground tabular-nums">
            {column.tasks.length}
          </span>
        </button>
      ))}
    </nav>
  );
}
