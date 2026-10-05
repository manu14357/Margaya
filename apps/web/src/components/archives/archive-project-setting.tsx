import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useArchiveProject } from "@/hooks/mutations/project/use-archive-project";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { toast } from "@/lib/toast";
import ArchiveProjectDialog from "./archive-project-dialog";

type ArchiveProjectSettingProps = {
  projectId: string;
  workspaceId: string;
};

/**
 * The danger zone's "Archive project" row; an archived project offers
 * Restore instead (B11 §1.6).
 */
export default function ArchiveProjectSetting({
  projectId,
  workspaceId,
}: ArchiveProjectSettingProps) {
  const { t } = useTranslation();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const archiveProject = useArchiveProject();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isArchived = Boolean(project?.archivedAt);

  const restore = () =>
    archiveProject.mutate(
      { projectId, workspaceId, archive: false },
      {
        onSuccess: () => toast.success(t("common:projectArchived.restored")),
        onError: () => toast.error(t("workspace:archives.toast.restoreError")),
      },
    );

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="space-y-0.5">
        <p className="font-medium text-sm">
          {t("settings:projectGeneral.archiveProject")}
        </p>
        <p className="text-muted-foreground text-xs">
          {isArchived
            ? t("common:projectArchived.message")
            : t("settings:projectGeneral.archiveProjectDescription")}
        </p>
      </div>
      {isArchived ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          loading={archiveProject.isPending}
          onClick={restore}
        >
          {t("common:projectArchived.restore")}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={!project}
          onClick={() => setConfirmOpen(true)}
        >
          {t("settings:projectGeneral.archiveProject")}
        </Button>
      )}
      <ArchiveProjectDialog
        project={
          project ? { id: project.id, name: project.name, workspaceId } : null
        }
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </div>
  );
}
