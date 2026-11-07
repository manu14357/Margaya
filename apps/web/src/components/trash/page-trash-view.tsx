import { FileText } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePurgePage,
  useRestoreDeletedPage,
} from "@/hooks/mutations/trash/use-trash-mutations";
import { usePageTrash } from "@/hooks/queries/trash/use-page-trash";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import TrashConfirmDialog from "./trash-confirm-dialog";
import TrashList from "./trash-list";
import type { TrashRowItem } from "./trash-row";

/** A project's deleted pages (C7). Who may act is decided per page. */
export default function PageTrashView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const query = usePageTrash(projectId, useDeferredValue(search));
  const restore = useRestoreDeletedPage(projectId);
  const purge = usePurgePage(projectId);
  const [confirm, setConfirm] = useState<TrashRowItem | null>(null);

  const items = useMemo<TrashRowItem[]>(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((page) => ({
        id: page.id,
        label: null,
        name: page.title.trim() || t("pages:list.untitled"),
        detail: null,
        deletedAt: page.deletedAt,
        deletedBy: page.deletedBy,
        purgeAt: page.purgeAt,
        canAct: page.canManage,
      })),
    [query.data, t],
  );

  const onRestore = async (item: TrashRowItem) => {
    try {
      await restore.mutateAsync(item.id);
      toast.success(t("settings:trash.toast.pageRestored"));
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
      toast.success(t("settings:trash.toast.pagePurged"));
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
        icon={<FileText className="size-4" />}
        canAct
        isPending={query.isPending}
        isError={query.isError}
        hasNextPage={Boolean(query.hasNextPage)}
        isFetchingNextPage={query.isFetchingNextPage}
        search={search}
        searchLabel={t("settings:trash.searchPages")}
        emptyTitle={t("settings:trash.emptyPagesTitle")}
        emptyDescription={t("settings:trash.emptyPagesDescription")}
        errorText={t("settings:trash.loadError")}
        onSearchChange={setSearch}
        onRetry={() => void query.refetch()}
        onLoadMore={() => void query.fetchNextPage()}
        onRestore={(item) => void onRestore(item)}
        onPurge={setConfirm}
      />
      <TrashConfirmDialog
        open={confirm !== null}
        title={t("settings:trash.purgePageTitle")}
        description={t("settings:trash.purgePageDescription", {
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
