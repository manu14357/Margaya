import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import getTaskRelations from "@/fetchers/task-relation/get-task-relations";
import useDeleteTaskRelations from "@/hooks/mutations/task-relation/use-delete-task-relations";
import { toast } from "@/lib/toast";
import type { DependencyLink } from "./selection-info";

// Deleting an arrow between two task cards removes only the drawing. When
// the arrow stood for a real "blocks" relation, a small prompt offers to
// remove that relation too; the arrow itself is already gone either way.

export type DependencyRelation = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  sourceKey: string;
  targetKey: string;
};

type RelationTask = {
  projectSlug?: string | null;
  number?: number | null;
  title?: string | null;
} | null;

type RelationRow = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  sourceTask?: RelationTask;
  targetTask?: RelationTask;
};

/** How long a fetched relation list answers the next delete without asking again. */
const RELATIONS_FRESH_MS = 5_000;

/** The stored relation an arrow from `sourceTaskId` to `targetTaskId` stands for. */
export function findBlockingRelation<R extends RelationRow>(
  rows: readonly R[] | null | undefined,
  sourceTaskId: string,
  targetTaskId: string,
): R | null {
  return (
    rows?.find(
      (row) =>
        row.relationType === "blocks" &&
        row.sourceTaskId === sourceTaskId &&
        row.targetTaskId === targetTaskId,
    ) ?? null
  );
}

function taskKey(task: RelationTask | undefined, fallback: string | null) {
  if (task?.projectSlug && task.number != null)
    return `${task.projectSlug}-${task.number}`;
  return fallback || task?.title || "";
}

/** A found relation, named the way the board's cards name their tasks. */
export function toDependencyRelation(
  row: RelationRow,
  cardKey: (taskId: string) => string | null,
): DependencyRelation {
  return {
    id: row.id,
    sourceTaskId: row.sourceTaskId,
    targetTaskId: row.targetTaskId,
    sourceKey: taskKey(row.sourceTask, cardKey(row.sourceTaskId)),
    targetKey: taskKey(row.targetTask, cardKey(row.targetTaskId)),
  };
}

export function useDependencyPrompt(options: {
  /** Off for read-only and public boards. */
  enabled: boolean;
  /** A card's task key (`KEY-12`), when the board knows it. */
  cardKey: (taskId: string) => string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const removal = useDeleteTaskRelations();
  const [items, setItems] = useState<DependencyRelation[]>([]);
  const latest = useRef(options);
  latest.current = options;

  /** Called after arrows were deleted; asks when some stood for a relation. */
  const ask = useCallback(
    async (links: readonly DependencyLink[]) => {
      if (!latest.current.enabled) return;
      const pairs = new Map<string, DependencyLink>();
      for (const link of links)
        pairs.set(`${link.sourceTaskId}>${link.targetTaskId}`, link);
      const found = await Promise.all(
        [...pairs.values()].map(async (link) => {
          try {
            const rows = (await queryClient.fetchQuery({
              queryKey: ["task-relations", link.sourceTaskId],
              queryFn: () => getTaskRelations(link.sourceTaskId),
              staleTime: RELATIONS_FRESH_MS,
            })) as RelationRow[];
            const row = findBlockingRelation(
              rows,
              link.sourceTaskId,
              link.targetTaskId,
            );
            return row
              ? toDependencyRelation(row, latest.current.cardKey)
              : null;
          } catch {
            // Without the relations there is nothing to offer.
            return null;
          }
        }),
      );
      const fresh = found.filter((item): item is DependencyRelation =>
        Boolean(item),
      );
      if (fresh.length === 0 || !latest.current.enabled) return;
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...fresh.filter((item) => !known.has(item.id))];
      });
    },
    [queryClient],
  );

  /** Removes relations now (the prompt's Remove, or "Remove dependency"). */
  const removeRelations = useCallback(
    (relations: readonly DependencyRelation[]) => {
      if (relations.length === 0) return;
      const ids = new Set(relations.map((item) => item.id));
      setItems((current) => current.filter((item) => !ids.has(item.id)));
      removal.mutate(
        relations.map(({ id, sourceTaskId, targetTaskId }) => ({
          id,
          sourceTaskId,
          targetTaskId,
        })),
        {
          onSuccess: ({ removed, failed }) => {
            toast.success(
              t("whiteboardEditor:tasks.dependencyRemoved", { count: removed }),
            );
            if (failed > 0)
              toast.error(t("whiteboardEditor:tasks.dependencyRemoveFailed"));
          },
          onError: () =>
            toast.error(t("whiteboardEditor:tasks.dependencyRemoveFailed")),
        },
      );
    },
    [removal, t],
  );

  const remove = useCallback(
    () => removeRelations(items),
    [items, removeRelations],
  );
  const keep = useCallback(() => setItems([]), []);

  return { items, ask, remove, keep, removeRelations };
}

/** The non-blocking question shown after a dependency arrow was deleted. */
export function DependencyPrompt({
  items,
  onRemove,
  onKeep,
}: {
  items: readonly DependencyRelation[];
  onRemove: () => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  const messageId = useId();
  const first = items[0];
  if (!first) return null;
  const message =
    items.length === 1
      ? t("whiteboardEditor:tasks.removeDependencyPrompt", {
          source: first.sourceKey,
          target: first.targetKey,
        })
      : t("whiteboardEditor:tasks.removeDependenciesPrompt", {
          count: items.length,
        });
  return (
    <section
      aria-label={t("whiteboardEditor:tasks.dependencyPromptLabel")}
      aria-describedby={messageId}
      aria-live="polite"
      className="flex max-w-md flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground text-sm shadow-lg/5"
      data-testid="whiteboard-dependency-prompt"
    >
      <p id={messageId}>{message}</p>
      {items.length > 1 && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground text-xs">
          {items.slice(0, 5).map((item) => (
            <li key={item.id}>
              {t("whiteboardEditor:tasks.dependencyPair", {
                source: item.sourceKey,
                target: item.targetKey,
              })}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="pointer-coarse:min-h-11"
          onClick={onKeep}
        >
          {t("whiteboardEditor:tasks.keepDependency")}
        </Button>
        <Button
          size="sm"
          variant="destructive-outline"
          className="pointer-coarse:min-h-11"
          onClick={onRemove}
        >
          {t("whiteboardEditor:tasks.removeDependencyConfirm")}
        </Button>
      </div>
    </section>
  );
}
