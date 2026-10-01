import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSlot } from "@/components/board/board-toolbar";
import { Button } from "@/components/ui/button";
import { getColumnIcon } from "@/lib/column";
import {
  searchCandidates,
  type TaskCandidate,
} from "@/lib/planning/candidates";
import PlanningSearchDialog from "./planning-search-dialog";

type TaskPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: readonly TaskCandidate[];
  /** Shown when no task can be added at all. */
  emptyText: string;
  /** Shown when the search matches no candidate. */
  noResultsText: string;
  isPending: boolean;
  /** Adds the picked tasks; call `done` once they are in to close and reset. */
  onSubmit: (taskIds: string[], done: () => void) => void;
};

/** "Add existing tasks": search the candidates, pick several, add them. */
export default function TaskPickerDialog({
  open,
  onOpenChange,
  candidates,
  emptyText,
  noResultsText,
  isPending,
  onSubmit,
}: TaskPickerDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = searchCandidates(candidates, query);

  const close = () => {
    setQuery("");
    setSelected(new Set());
    onOpenChange(false);
  };

  const toggle = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  return (
    <PlanningSearchDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("planning:addExisting.title")}
      query={query}
      onQueryChange={setQuery}
      placeholder={t("planning:addExisting.searchPlaceholder")}
      footer={
        <>
          <span />
          <Button
            size="sm"
            disabled={selected.size === 0}
            loading={isPending}
            onClick={() => onSubmit([...selected], close)}
          >
            {t("planning:addExisting.submit", { count: selected.size })}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          {emptyText}
        </p>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          {noResultsText}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map(({ task, key, column }) => {
            const isSelected = selected.has(task.id);
            return (
              <li key={task.id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggle(task.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <CheckSlot checked={isSelected} />
                  {getColumnIcon(column.slug, false, column.icon, column.group)}
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {key}
                  </span>
                  <span className="truncate">{task.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PlanningSearchDialog>
  );
}
