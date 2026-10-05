import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useArchiveCycle } from "@/hooks/mutations/cycle/use-archive-cycle";
import { useDeleteCycle } from "@/hooks/mutations/cycle/use-delete-cycle";
import { useArchiveModule } from "@/hooks/mutations/module/use-archive-module";
import { useDeleteModule } from "@/hooks/mutations/module/use-delete-module";
import { useArchiveProject } from "@/hooks/mutations/project/use-archive-project";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { toast } from "@/lib/toast";
import type { ArchivedEntity } from "@/types/archive";

const RESTORED_KEYS = {
  cycle: "workspace:archives.toast.cycleRestored",
  module: "workspace:archives.toast.moduleRestored",
  project: "workspace:archives.toast.projectRestored",
} as const;

const DELETED_KEYS = {
  cycle: "cycles:toast.deleted",
  module: "modules:toast.deleted",
  project: "navigation:projectList.deletedToast",
} as const;

const DELETE_ERROR_KEYS = {
  cycle: "cycles:toast.deleteError",
  module: "modules:toast.deleteError",
  project: "settings:projectGeneral.toastDeleteError",
} as const;

/**
 * Open, restore and delete an archived cycle, module or project through
 * each owner's routes; the archives refresh after every change.
 */
export function useArchivedEntityActions(workspaceId: string) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mutateAsync: archiveCycle } = useArchiveCycle();
  const { mutateAsync: archiveModule } = useArchiveModule();
  const { mutateAsync: archiveProject } = useArchiveProject();
  const { mutateAsync: deleteCycle } = useDeleteCycle();
  const { mutateAsync: deleteModule } = useDeleteModule();
  const { mutateAsync: deleteProject } = useDeleteProject();

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: archiveQueryKeys.all() });
  }, [queryClient]);

  const open = useCallback(
    (item: ArchivedEntity) => {
      const params = { workspaceId, projectId: item.projectId };
      if (item.type === "cycle") {
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/cycles/$cycleId",
          params: { ...params, cycleId: item.id },
        });
      } else if (item.type === "module") {
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId",
          params: { ...params, moduleId: item.id },
        });
      } else {
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
          params,
        });
      }
    },
    [navigate, workspaceId],
  );

  /** True when the item was restored. */
  const restore = useCallback(
    async (item: ArchivedEntity): Promise<boolean> => {
      try {
        if (item.type === "cycle") {
          await archiveCycle({
            cycleId: item.id,
            projectId: item.projectId,
            archive: false,
          });
        } else if (item.type === "module") {
          await archiveModule({
            moduleId: item.id,
            projectId: item.projectId,
            archive: false,
          });
        } else {
          await archiveProject({
            projectId: item.id,
            workspaceId,
            archive: false,
          });
        }
        toast.success(t(RESTORED_KEYS[item.type]));
        return true;
      } catch {
        toast.error(t("workspace:archives.toast.restoreError"));
        return false;
      } finally {
        refresh();
      }
    },
    [archiveCycle, archiveModule, archiveProject, workspaceId, refresh, t],
  );

  /** True when the item was deleted. */
  const remove = useCallback(
    async (item: ArchivedEntity): Promise<boolean> => {
      try {
        if (item.type === "cycle") {
          await deleteCycle({ cycleId: item.id, projectId: item.projectId });
        } else if (item.type === "module") {
          await deleteModule({ moduleId: item.id, projectId: item.projectId });
        } else {
          await deleteProject({ id: item.id });
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
        }
        toast.success(t(DELETED_KEYS[item.type]));
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t(DELETE_ERROR_KEYS[item.type]),
        );
        return false;
      } finally {
        refresh();
      }
    },
    [deleteCycle, deleteModule, deleteProject, queryClient, refresh, t],
  );

  return { open, restore, remove };
}
