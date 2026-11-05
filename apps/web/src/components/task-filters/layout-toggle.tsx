import {
  CalendarDays,
  CalendarRange,
  PanelsTopLeft,
  Rows3,
  Sheet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
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

/**
 * The toolbar's layout buttons: icons only on small screens, and everywhere
 * with `iconsOnly` (under a project's tab row, which already names them).
 */
export default function LayoutToggle({
  layouts,
  value,
  onChange,
  iconsOnly = false,
}: {
  layouts: readonly TaskLayout[];
  value: TaskLayout;
  onChange: (layout: TaskLayout) => void;
  iconsOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("tasks:view.layout")}
      value={[value]}
      onValueChange={(values) => {
        const next = layouts.find((layout) => layout === values[0]);
        if (next) onChange(next);
      }}
    >
      {layouts.map((layout) => {
        const meta = LAYOUT_META[layout];
        return (
          <Toggle
            key={layout}
            value={layout}
            aria-label={t(meta.labelKey)}
            title={t(meta.labelKey)}
            className="gap-1"
          >
            {meta.icon}
            {!iconsOnly && (
              <span className="hidden md:inline">{t(meta.labelKey)}</span>
            )}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
