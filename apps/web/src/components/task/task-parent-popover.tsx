import { Check, Search, X } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import useSetTaskParent from "@/hooks/mutations/task-relation/use-set-task-parent";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { formatTaskKey } from "@/lib/task-key";
import {
  boardTaskList,
  matchesTaskQuery,
  oldestParent,
  parentCandidates,
} from "@/lib/task-relations";
import { toast } from "@/lib/toast";

type TaskParentPopoverProps = {
  task: { id: string; projectId: string };
  children: ReactElement;
};

const optionClassName =
  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-64";

/**
 * Sets, changes or clears the task's parent, a task of the same project.
 * Without task:update it only shows the trigger.
 */
export default function TaskParentPopover({
  task,
  children,
}: TaskParentPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { canUpdateTasks } = useWorkspacePermission();
  const { data: relations = [] } = useGetTaskRelations(task.id);
  const { data: board, isLoading } = useGetTasks(open ? task.projectId : "");
  const setParent = useSetTaskParent();

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const handle = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(handle);
  }, [open]);

  const parent = oldestParent(relations, task.id)?.sourceTask ?? null;
  const slug = board?.slug ?? "";
  const columns = useMemo(
    () => new Map((board?.columns ?? []).map((column) => [column.id, column])),
    [board],
  );
  const candidates = useMemo(
    () =>
      parentCandidates(boardTaskList(board), relations, task.id)
        .map((candidate) => ({
          ...candidate,
          key: formatTaskKey(slug, candidate.number),
        }))
        .filter((candidate) =>
          matchesTaskQuery(query, candidate.key, candidate.title),
        ),
    [board, query, relations, slug, task.id],
  );

  if (!canUpdateTasks()) return children;

  const parentKey = parent
    ? formatTaskKey(parent.projectSlug, parent.number)
    : null;
  const showParent =
    parent && parentKey && matchesTaskQuery(query, parentKey, parent.title);

  const choose = (parentTaskId: string | null, key?: string) => {
    setOpen(false);
    if (parentTaskId === (parent?.id ?? null)) return;
    setParent.mutate(
      { taskId: task.id, parentTaskId, projectId: task.projectId },
      {
        onSuccess: () => {
          toast.success(
            parentTaskId
              ? t("tasks:parent.toast.set", { key })
              : t("tasks:parent.toast.removed"),
          );
        },
        onError: (error) => {
          toast.error(error.message || t("tasks:parent.toast.error"));
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        <div className="flex items-center gap-2 border-border border-b p-2">
          <Search className="size-3 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("tasks:parent.search")}
            aria-label={t("tasks:parent.search")}
            className="h-auto border-none p-0 shadow-none focus-visible:ring-0 !bg-transparent"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {parent && (
            <button
              type="button"
              className={optionClassName}
              onClick={() => choose(null)}
            >
              <X className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("tasks:parent.remove")}
              </span>
            </button>
          )}
          {showParent && (
            <button
              type="button"
              className={optionClassName}
              onClick={() => choose(parent.id, parentKey)}
            >
              {getColumnIcon("", false, undefined, parent.group)}
              <span className="shrink-0 font-mono text-muted-foreground">
                {parentKey}
              </span>
              <span className="min-w-0 flex-1 truncate">{parent.title}</span>
              <Check className="size-3.5 shrink-0" />
            </button>
          )}
          <p className="px-2 pt-1.5 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            {t("tasks:parent.tasksInProject")}
          </p>
          {isLoading ? (
            <div className="flex flex-col gap-1.5 px-2 py-1">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("tasks:parent.noTasks")}
            </p>
          ) : (
            candidates.map((candidate) => {
              const column = columns.get(candidate.status);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={optionClassName}
                  onClick={() => choose(candidate.id, candidate.key)}
                >
                  {getColumnIcon(
                    candidate.status,
                    column?.isFinal,
                    column?.icon,
                    column?.group,
                  )}
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {candidate.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {candidate.title}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
