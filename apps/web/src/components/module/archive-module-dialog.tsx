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
import { useArchiveModule } from "@/hooks/mutations/module/use-archive-module";
import { toast } from "@/lib/toast";
import type { Module } from "@/types/module";

type ArchiveModuleDialogProps = {
  module: Pick<Module, "id" | "projectId">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Confirms archiving a completed or cancelled module. */
export default function ArchiveModuleDialog({
  module,
  open,
  onOpenChange,
}: ArchiveModuleDialogProps) {
  const { t } = useTranslation();
  const archive = useArchiveModule();

  const handleArchive = () => {
    archive.mutate(
      { moduleId: module.id, projectId: module.projectId, archive: true },
      {
        onSuccess: () => {
          toast.success(t("modules:toast.archived"));
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(error.message || t("modules:toast.archiveError")),
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !archive.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("modules:archive.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("modules:archive.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={archive.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("modules:archive.cancel")}
          </Button>
          <Button loading={archive.isPending} onClick={handleArchive}>
            {t("modules:archive.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
