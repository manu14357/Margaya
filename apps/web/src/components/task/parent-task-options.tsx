import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { getColumnIcon } from "@/lib/column";
import { formatTaskKey } from "@/lib/task-key";
import { boardTaskList, matchesTaskQuery } from "@/lib/task-relations";

type Board = NonNullable<ReturnType<typeof useGetTasks>["data"]>;
export type ProjectBoardTask = Board["columns"][number]["tasks"][number];
type BoardTasks = ProjectBoardTask[];

export type ParentOption = {
  id: string;
  key: string;
  title: string;
  group?: string | null;
};

type ParentTaskOptionsProps = {
  projectId: string;
  /** The current parent, listed first with a check and a Remove option. */
  current: ParentOption | null;
  /** Narrows the project's tasks to those that may become the parent. */
  candidates: (tasks: BoardTasks) => BoardTasks;
  onChoose: (parent: ParentOption | null) => void;
};

const optionClassName =
  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/50 disabled:pointer-events-none disabled:opacity-64";

/**
 * The searchable list of a project's tasks a parent is picked from. Shared
 * by the task's parent popover and the create-task dialog; mount it only
 * while its popover is open, since it loads the project's board.
 */
export default function ParentTaskOptions({
  projectId,
  current,
  candidates: narrow,
  onChoose,
}: ParentTaskOptionsProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: board, isLoading } = useGetTasks(projectId);

  useEffect(() => {
    const handle = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(handle);
  }, []);

  const slug = board?.slug ?? "";
  const columns = useMemo(
    () => new Map((board?.columns ?? []).map((column) => [column.id, column])),
    [board],
  );
  const candidates = useMemo(
    () =>
      narrow(boardTaskList(board))
        // Tasks waiting in intake can't be linked.
        .filter(
          (task) =>
            task.id !== current?.id &&
            columns.get(task.status)?.group !== "triage",
        )
        .map((candidate) => ({
          ...candidate,
          key: formatTaskKey(slug, candidate.number),
        }))
        .filter((candidate) =>
          matchesTaskQuery(query, candidate.key, candidate.title),
        ),
    [board, columns, current?.id, narrow, query, slug],
  );

  const showCurrent =
    current && matchesTaskQuery(query, current.key, current.title);

  return (
    <>
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
        {current && (
          <button
            type="button"
            className={optionClassName}
            onClick={() => onChoose(null)}
          >
            <X className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("tasks:parent.remove")}
            </span>
          </button>
        )}
        {showCurrent && (
          <button
            type="button"
            className={optionClassName}
            onClick={() => onChoose(current)}
          >
            {getColumnIcon("", false, undefined, current.group)}
            <span className="shrink-0 font-mono text-muted-foreground">
              {current.key}
            </span>
            <span className="min-w-0 flex-1 truncate">{current.title}</span>
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
                onClick={() =>
                  onChoose({
                    id: candidate.id,
                    key: candidate.key,
                    title: candidate.title,
                    group: column?.group,
                  })
                }
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
    </>
  );
}
