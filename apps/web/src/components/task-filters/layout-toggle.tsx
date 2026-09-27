import {
  CalendarDays,
  CalendarRange,
  PanelsTopLeft,
  Rows3,
  Sheet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { TaskLayout } from "@/lib/task-query/model";

const LAYOUT_META: Record<TaskLayout, { icon: ReactNode; labelKey: string }> = {
  list: { icon: <Rows3 className="h-3 w-3" />, labelKey: "tasks:view.list" },
  board: {
    icon: <PanelsTopLeft className="h-3 w-3" />,
    labelKey: "tasks:view.board",
  },
  spreadsheet: {
    icon: <Sheet className="h-3 w-3" />,
    labelKey: "tasks:view.spreadsheet",
  },
  calendar: {
    icon: <CalendarRange className="h-3 w-3" />,
    labelKey: "tasks:calendar.title",
  },
  gantt: {
    icon: <CalendarDays className="h-3 w-3" />,
    labelKey: "tasks:view.gantt",
  },
};

/** The toolbar's layout buttons (the Board/List toggle's look). */
export default function LayoutToggle({
  layouts,
  value,
  onChange,
}: {
  layouts: readonly TaskLayout[];
  value: TaskLayout;
  onChange: (layout: TaskLayout) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex items-center gap-1">
      {layouts.map((layout) => {
        const meta = LAYOUT_META[layout];
        const active = layout === value;
        return (
          <button
            key={layout}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(layout)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-2 font-medium text-xs transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {meta.icon}
            <span className="hidden md:inline">{t(meta.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
