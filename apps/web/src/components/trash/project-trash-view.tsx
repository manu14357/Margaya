import { FolderKanban } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePurgeProject,
  useRestoreProject,
} from "@/hooks/mutations/trash/use-trash-mutations";
import { useProjectTrash } from "@/hooks/queries/trash/use-project-trash";
import { toast } from "@/lib/toast";
import TrashConfirmDialog from "./trash-confirm-dialog";
import TrashList from "./trash-list";
import type { TrashRowItem } from "./trash-row";

type ProjectTrashViewProps = {
  workspaceId: string;
  /** project:delete: restore and delete permanently. */
  canDelete: boolean;
};

/** The workspace's "Recently deleted projects" (C7). */
export default function ProjectTrashView({
  workspaceId,
  canDelete,
}: ProjectTrashViewProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = useProjectTrash(workspaceId, useDeferredValue(search));
  const restore = useRestoreProject();
  const purge = usePurgeProject();
  const [purging, setPurging] = useState<TrashRowItem | null>(null);

  const items = useMemo<TrashRowItem[]>(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).map(
        (project) => ({
          id: project.id,
          label: project.slug.toUpperCase(),
          name: project.name,
          detail: t("settings:trash.taskCount", { count: project.taskCount }),
          deletedAt: project.deletedAt,
          deletedBy: project.deletedBy,
          purgeAt: project.purgeAt,
        }),
      ),
    [query.data, t],
  );

  const onRestore = async (item: TrashRowItem) => {
    try {
      await restore.mutateAsync(item.id);
      toast.success(t("settings:trash.toast.projectRestored"));
    } catch {
      toast.error(t("settings:trash.toast.restoreError"));
    }
  };

  const onConfirm = async () => {
    if (!purging) return;
    try {
      await purge.mutateAsync(purging.id);
      toast.success(t("settings:trash.toast.projectPurged"));
    } catch {
      toast.error(t("settings:trash.toast.purgeError"));
    } finally {
      setPurging(null);
    }
  };

  return (
    <>
      <TrashList
        items={items}
        icon={<FolderKanban className="size-4" />}
        canAct={canDelete}
        isPending={query.isPending}
        isError={query.isError}
        hasNextPage={Boolean(query.hasNextPage)}
        isFetchingNextPage={query.isFetchingNextPage}
        search={search}
        searchLabel={t("settings:trash.searchProjects")}
        emptyTitle={t("settings:trash.emptyProjectsTitle")}
        emptyDescription={t("settings:trash.emptyProjectsDescription")}
        errorText={t("settings:trash.loadError")}
        onSearchChange={setSearch}
        onRetry={() => void query.refetch()}
        onLoadMore={() => void query.fetchNextPage()}
        onRestore={(item) => void onRestore(item)}
        onPurge={setPurging}
      />
      <TrashConfirmDialog
        open={purging !== null}
        title={t("settings:trash.purgeProjectTitle")}
        description={t("settings:trash.purgeProjectDescription", {
          name: purging?.name ?? "",
        })}
        action={t("settings:trash.deletePermanently")}
        pending={purge.isPending}
        onCancel={() => setPurging(null)}
        onConfirm={() => void onConfirm()}
      />
    </>
  );
}
