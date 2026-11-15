import { PenTool } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePurgeWhiteboard,
  useRestoreDeletedWhiteboard,
} from "@/hooks/mutations/trash/use-whiteboard-trash-mutations";
import { useWhiteboardTrash } from "@/hooks/queries/trash/use-whiteboard-trash";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import TrashConfirmDialog from "./trash-confirm-dialog";
import TrashList from "./trash-list";
import type { TrashRowItem } from "./trash-row";

/** A project's deleted whiteboards. Who may act is decided per board. */
export default function WhiteboardTrashView({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = useWhiteboardTrash(projectId, useDeferredValue(search));
  const restore = useRestoreDeletedWhiteboard(projectId);
  const purge = usePurgeWhiteboard(projectId);
  const [confirm, setConfirm] = useState<TrashRowItem | null>(null);

  const items = useMemo<TrashRowItem[]>(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((board) => ({
        id: board.id,
        label: null,
        name: board.title.trim() || t("whiteboards:list.untitled"),
        detail: null,
        deletedAt: board.deletedAt,
        deletedBy: board.deletedBy,
        purgeAt: board.purgeAt,
        canAct: board.canManage,
      })),
    [query.data, t],
  );

  const onRestore = async (item: TrashRowItem) => {
    try {
      await restore.mutateAsync(item.id);
      toast.success(t("settings:trash.toast.whiteboardRestored"));
    } catch (error) {
      toast.error(
        pageErrorMessage(error) ?? t("settings:trash.toast.restoreError"),
      );
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    try {
      await purge.mutateAsync(confirm.id);
      toast.success(t("settings:trash.toast.whiteboardPurged"));
    } catch {
      toast.error(t("settings:trash.toast.purgeError"));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <TrashList
        items={items}
        icon={<PenTool className="size-4" />}
        canAct
        isPending={query.isPending}
        isError={query.isError}
        hasNextPage={Boolean(query.hasNextPage)}
        isFetchingNextPage={query.isFetchingNextPage}
        search={search}
        searchLabel={t("settings:trash.searchWhiteboards")}
        emptyTitle={t("settings:trash.emptyWhiteboardsTitle")}
        emptyDescription={t("settings:trash.emptyWhiteboardsDescription")}
        errorText={t("settings:trash.loadError")}
        onSearchChange={setSearch}
        onRetry={() => void query.refetch()}
        onLoadMore={() => void query.fetchNextPage()}
        onRestore={(item) => void onRestore(item)}
        onPurge={setConfirm}
      />
      <TrashConfirmDialog
        open={confirm !== null}
        title={t("settings:trash.purgeWhiteboardTitle")}
        description={t("settings:trash.purgeWhiteboardDescription", {
          name: confirm?.name ?? "",
        })}
        action={t("settings:trash.deletePermanently")}
        pending={purge.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void onConfirm()}
      />
    </>
  );
}
