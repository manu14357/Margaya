import { useNavigate } from "@tanstack/react-router";
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
import { useArchiveProject } from "@/hooks/mutations/project/use-archive-project";
import { toast } from "@/lib/toast";

type ArchiveProjectDialogProps = {
  project: { id: string; name: string; workspaceId: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** "Archive {name}?": hides the project; it can be restored from Archives. */
export default function ArchiveProjectDialog({
  project,
  open,
  onOpenChange,
}: ArchiveProjectDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const archiveProject = useArchiveProject();

  const handleArchive = () => {
    if (!project) return;
    archiveProject.mutate(
      {
        projectId: project.id,
        workspaceId: project.workspaceId,
        archive: true,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("settings:projectGeneral.toastArchived"));
          navigate({
            to: "/dashboard/workspace/$workspaceId/projects",
            params: { workspaceId: project.workspaceId },
          });
        },
        onError: (error) =>
          toast.error(
            error.message || t("settings:projectGeneral.toastArchiveError"),
          ),
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !archiveProject.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectGeneral.archiveConfirmTitle", {
              name: project?.name ?? "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings:projectGeneral.archiveProjectDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={archiveProject.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            loading={archiveProject.isPending}
            onClick={handleArchive}
          >
            {t("settings:projectGeneral.archiveConfirmAction")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
