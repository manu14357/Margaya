import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSlot } from "@/components/task-filters/filter-primitives";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import {
  type BoardView,
  PUBLIC_PRIORITIES,
  toggleValue,
} from "@/lib/public-board/search-params";
import type { PublicBoard } from "@/types/public-board";

export type BoardViewChange = (patch: Partial<BoardView>) => void;

const rowClassName =
  "inline-flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs";

function rowState(selected: boolean) {
  return selected
    ? "bg-accent text-accent-foreground"
    : "text-foreground/90 hover:bg-accent/60 hover:text-foreground";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-0.5">{children}</div>
    </div>
  );
}

function OptionRow({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={cn(rowClassName, rowState(checked))}
      onClick={onClick}
    >
      <CheckSlot checked={checked} />
      {children}
    </button>
  );
}

type PublicFilterSectionsProps = {
  board: PublicBoard;
  view: BoardView;
  onChange: BoardViewChange;
};

/** Status, Priority and Labels check rows (the popover and the sheet). */
export default function PublicFilterSections({
  board,
  view,
  onChange,
}: PublicFilterSectionsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Section title={t("publicProject:board.sections.status")}>
        {board.columns.map((column) => (
          <OptionRow
            key={column.slug}
            checked={view.status.includes(column.slug)}
            onClick={() =>
              onChange({ status: toggleValue(view.status, column.slug) })
            }
          >
            {getColumnIcon(
              column.slug,
              column.isFinal,
              column.icon,
              column.group,
            )}
            <span className="truncate">
              {column.slug === "planned"
                ? t("publicProject:board.backlog")
                : column.name}
            </span>
          </OptionRow>
        ))}
      </Section>
      <Section title={t("publicProject:board.sections.priority")}>
        {PUBLIC_PRIORITIES.map((priority) => (
          <OptionRow
            key={priority}
            checked={view.priority.includes(priority)}
            onClick={() =>
              onChange({ priority: toggleValue(view.priority, priority) })
            }
          >
            {getPriorityIcon(priority)}
            <span className="truncate">{getPriorityLabel(priority)}</span>
          </OptionRow>
        ))}
      </Section>
      {board.labels.length > 0 && (
        <Section title={t("publicProject:board.sections.labels")}>
          <div className="grid max-h-48 grid-cols-1 gap-0.5 overflow-y-auto">
            {board.labels.map((label) => (
              <OptionRow
                key={label.name}
                checked={view.label.includes(label.name)}
                onClick={() =>
                  onChange({ label: toggleValue(view.label, label.name) })
                }
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: resolveLabelColor(label.color) }}
                />
                <span className="truncate">{label.name}</span>
              </OptionRow>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
