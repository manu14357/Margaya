import { CircleDashed } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  useEmptyTaskTrash,
  usePurgeTask,
  useRestoreTask,
} from "@/hooks/mutations/trash/use-trash-mutations";
import { useTaskTrash } from "@/hooks/queries/trash/use-task-trash";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import TrashConfirmDialog from "./trash-confirm-dialog";
import TrashList from "./trash-list";
import type { TrashRowItem } from "./trash-row";

type TaskTrashViewProps = {
  projectId: string;
  /** task:delete: restore and delete permanently. */
  canDelete: boolean;
};

type Confirm = { kind: "purge"; item: TrashRowItem } | { kind: "empty" };

/** A project's "Recently deleted" tasks (C7). */
export default function TaskTrashView({
  projectId,
  canDelete,
}: TaskTrashViewProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = useTaskTrash(projectId, useDeferredValue(search));
  const restore = useRestoreTask(projectId);
  const purge = usePurgeTask(projectId);
  const empty = useEmptyTaskTrash(projectId);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const items = useMemo<TrashRowItem[]>(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((task) => ({
        id: task.id,
        label: task.key.toUpperCase(),
        name: task.title,
        detail:
          task.subTaskCount > 0
            ? t("settings:trash.withSubTasks", { count: task.subTaskCount })
            : null,
        deletedAt: task.deletedAt,
        deletedBy: task.deletedBy,
        purgeAt: task.purgeAt,
      })),
    [query.data, t],
  );

  const onRestore = async (item: TrashRowItem) => {
    try {
      await restore.mutateAsync(item.id);
      toast.success(t("settings:trash.toast.taskRestored"));
    } catch (error) {
      toast.error(
        error instanceof HttpError && error.status === 409
          ? t("settings:trash.toast.restoreBlocked")
          : t("settings:trash.toast.restoreError"),
      );
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === "purge") {
        await purge.mutateAsync(confirm.item.id);
        toast.success(t("settings:trash.toast.taskPurged"));
      } else {
        const { deletedCount } = await empty.mutateAsync();
        toast.success(
          t("settings:trash.toast.emptied", { count: deletedCount }),
        );
      }
    } catch {
      toast.error(t("settings:trash.toast.purgeError"));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {canDelete && items.length > 0 && !search.trim() && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirm({ kind: "empty" })}
          >
            {t("settings:trash.emptyTrash")}
          </Button>
        </div>
      )}
      <TrashList
        items={items}
        icon={<CircleDashed className="size-4" />}
        canAct={canDelete}
        isPending={query.isPending}
        isError={query.isError}
        hasNextPage={Boolean(query.hasNextPage)}
        isFetchingNextPage={query.isFetchingNextPage}
        search={search}
        searchLabel={t("settings:trash.searchTasks")}
        emptyTitle={t("settings:trash.emptyTasksTitle")}
        emptyDescription={t("settings:trash.emptyTasksDescription")}
        errorText={t("settings:trash.loadError")}
        onSearchChange={setSearch}
        onRetry={() => void query.refetch()}
        onLoadMore={() => void query.fetchNextPage()}
        onRestore={(item) => void onRestore(item)}
        onPurge={(item) => setConfirm({ kind: "purge", item })}
      />
      <TrashConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "empty"
            ? t("settings:trash.emptyConfirmTitle")
            : t("settings:trash.purgeTaskTitle")
        }
        description={
          confirm?.kind === "purge"
            ? t("settings:trash.purgeTaskDescription", {
                name: confirm.item.name,
              })
            : t("settings:trash.emptyConfirmDescription")
        }
        action={
          confirm?.kind === "empty"
            ? t("settings:trash.emptyTrash")
            : t("settings:trash.deletePermanently")
        }
        pending={purge.isPending || empty.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      />
    </div>
  );
}
