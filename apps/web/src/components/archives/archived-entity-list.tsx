import { Archive } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useArchivedEntities } from "@/hooks/queries/archive/use-archived-entities";
import type { ArchivedEntity, ArchivedEntityType } from "@/types/archive";
import ArchivedEntityRow from "./archived-entity-row";
import { useArchivedEntityActions } from "./use-archived-entity-actions";

const COPY = {
  cycle: {
    emptyTitle: "workspace:archives.empty.cyclesTitle",
    emptyDescription: "workspace:archives.empty.cyclesDescription",
    error: "workspace:archives.error.cycles",
    deleteTitle: "cycles:delete.title",
    deleteDescription: "workspace:archives.deleteConfirm.cycleDescription",
    deleteAction: "cycles:delete.confirm",
  },
  module: {
    emptyTitle: "workspace:archives.empty.modulesTitle",
    emptyDescription: "workspace:archives.empty.modulesDescription",
    error: "workspace:archives.error.modules",
    deleteTitle: "modules:delete.title",
    deleteDescription: "workspace:archives.deleteConfirm.moduleDescription",
    deleteAction: "modules:delete.confirm",
  },
  project: {
    emptyTitle: "workspace:archives.empty.projectsTitle",
    emptyDescription: "workspace:archives.empty.projectsDescription",
    error: "workspace:archives.error.projects",
    deleteTitle: "navigation:projectList.deleteConfirmTitle",
    deleteDescription: "navigation:projectList.deleteConfirmDescription",
    deleteAction: "navigation:projectList.deleteProject",
  },
} as const;

type ArchivedEntityListProps = {
  workspaceId: string;
  /** The project scope, or the workspace's project filter. */
  projectId?: string;
  type: ArchivedEntityType;
  showProject: boolean;
};

/** Archived cycles, modules or projects in scope (B11 §1.5). */
export default function ArchivedEntityList({
  workspaceId,
  projectId,
  type,
  showProject,
}: ArchivedEntityListProps) {
  const { t } = useTranslation();
  const copy = COPY[type];
  const query = useArchivedEntities({
    workspaceId,
    projectId: type === "project" ? undefined : projectId,
    type,
  });
  const actions = useArchivedEntityActions(workspaceId);
  // Restored or deleted rows leave at once; a failure brings them back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [deleting, setDeleting] = useState<ArchivedEntity | null>(null);

  const items = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (item) => !hidden.has(item.id),
      ),
    [query.data, hidden],
  );

  const hide = (id: string, value: boolean) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const runHidden = async (
    item: ArchivedEntity,
    action: (item: ArchivedEntity) => Promise<boolean>,
  ) => {
    hide(item.id, true);
    const done = await action(item);
    if (!done) hide(item.id, false);
  };

  if (query.isPending) {
    return (
      <div className="divide-y divide-border/50">
        {["one", "two", "three"].map((key) => (
          <div key={key} className="flex h-11 items-center gap-3 px-4">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex items-center gap-3 px-4 py-6 text-muted-foreground text-sm">
        <span>{t(copy.error)}</span>
        <Button variant="outline" size="xs" onClick={() => query.refetch()}>
          {t("workspace:archives.error.retry")}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive />
          </EmptyMedia>
          <EmptyTitle>{t(copy.emptyTitle)}</EmptyTitle>
          <EmptyDescription>{t(copy.emptyDescription)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      {items.map((item) => (
        <ArchivedEntityRow
          key={item.id}
          item={item}
          showProject={showProject}
          onOpen={() => actions.open(item)}
          onRestore={() => void runHidden(item, actions.restore)}
          onDelete={() => setDeleting(item)}
        />
      ))}
      {query.hasNextPage && (
        <div className="px-4 py-2">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("tasks:drafts.loadMore")}
          </Button>
        </div>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(copy.deleteTitle)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(copy.deleteDescription, { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleting(null)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (deleting) void runHidden(deleting, actions.remove);
                setDeleting(null);
              }}
            >
              {t(copy.deleteAction)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
