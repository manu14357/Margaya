// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import { Check, Search } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import type Task from "@/types/task";
import type { BoardController } from "./controller";
import { visibleRect } from "./viewport";

const MAX_RESULTS = 100;
const CARD = { width: 260, height: 120, gap: 24, perRow: 4 };

type TaskPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: BoardController;
  tasks: readonly Task[];
  projectSlug: string;
  isLoading: boolean;
};

/** Case-insensitive match on the title or the task key (e.g. "WEB-12"). */
export function filterTasks(
  tasks: readonly Task[],
  query: string,
  slug: string,
): Task[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tasks.slice(0, MAX_RESULTS);
  const result: Task[] = [];
  for (const task of tasks) {
    const key =
      task.number != null ? `${slug}-${task.number}`.toLowerCase() : "";
    if (task.title.toLowerCase().includes(needle) || key.includes(needle)) {
      result.push(task);
      if (result.length >= MAX_RESULTS) break;
    }
  }
  return result;
}

/** Lays out new task cards in rows around the centre of the view. */
export function insertTaskCards(
  c: BoardController,
  taskIds: readonly string[],
): boolean {
  if (taskIds.length === 0) return false;
  const { viewport, width, height } = c.state;
  const view = visibleRect(viewport, width, height);
  const columns = Math.min(CARD.perRow, taskIds.length);
  const rows = Math.ceil(taskIds.length / CARD.perRow);
  const totalW = columns * CARD.width + (columns - 1) * CARD.gap;
  const totalH = rows * CARD.height + (rows - 1) * CARD.gap;
  const left = view.x + view.width / 2 - totalW / 2;
  const top = view.y + view.height / 2 - totalH / 2;
  const cards = taskIds.map((taskId, index) =>
    c.newElement("task", {
      taskId,
      x: left + (index % CARD.perRow) * (CARD.width + CARD.gap),
      y: top + Math.floor(index / CARD.perRow) * (CARD.height + CARD.gap),
      width: CARD.width,
      height: CARD.height,
    }),
  );
  return c.insert(cards);
}

export function TaskPickerDialog({
  open,
  onOpenChange,
  controller,
  tasks,
  projectSlug,
  isLoading,
}: TaskPickerDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const deferred = useDeferredValue(query);
  const hintId = useId();

  useEffect(() => {
    if (open) {
      setQuery("");
      setPicked([]);
    }
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed each time the dialog opens
  const onBoard = useMemo(() => {
    const ids = new Set<string>();
    for (const element of controller.scene.elements) {
      if (element.type === "task") ids.add(element.taskId);
    }
    return ids;
  }, [controller, open]);

  const results = useMemo(
    () => filterTasks(tasks, deferred, projectSlug),
    [tasks, deferred, projectSlug],
  );

  const toggle = (taskId: string) =>
    setPicked((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );

  // Says why the add button waits, while there are tasks to pick.
  const showHint = picked.length === 0 && results.length > 0 && !isLoading;

  const confirm = () => {
    if (insertTaskCards(controller, picked)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("whiteboardEditor:tasks.pickerTitle")}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("whiteboardEditor:tasks.searchPlaceholder")}
              aria-label={t("whiteboardEditor:tasks.searchPlaceholder")}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  picked.length === 0 &&
                  results[0]
                ) {
                  event.preventDefault();
                  if (insertTaskCards(controller, [results[0].id]))
                    onOpenChange(false);
                }
              }}
            />
          </InputGroup>
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {t("whiteboardEditor:tasks.noResults")}
            </p>
          ) : (
            <ul
              className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
              aria-label={t("whiteboardEditor:tasks.results")}
            >
              {results.map((task) => {
                const selected = picked.includes(task.id);
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggle(task.id)}
                      className={cn(
                        "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 motion-reduce:transition-none",
                        selected && "bg-accent text-accent-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border border-input",
                          selected &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                        aria-hidden="true"
                      >
                        {selected && <Check className="size-3" />}
                      </span>
                      {task.number != null && (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {projectSlug}-{task.number}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {task.title}
                      </span>
                      {onBoard.has(task.id) && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {t("whiteboardEditor:tasks.onBoard")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showHint && (
            <p id={hintId} className="text-muted-foreground text-xs">
              {t("whiteboardEditor:tasks.pickHint")}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("whiteboardEditor:actions.cancel")}
          </Button>
          <Button
            disabled={picked.length === 0}
            aria-describedby={showHint ? hintId : undefined}
            onClick={confirm}
            data-testid="whiteboard-add-task-cards"
          >
            {picked.length === 0
              ? t("whiteboardEditor:tasks.addCardsNone")
              : t("whiteboardEditor:tasks.addCards", { count: picked.length })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
