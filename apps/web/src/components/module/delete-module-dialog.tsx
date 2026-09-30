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
import { useDeleteModule } from "@/hooks/mutations/module/use-delete-module";
import { toast } from "@/lib/toast";
import type { Module } from "@/types/module";

type DeleteModuleDialogProps = {
  module: Pick<Module, "id" | "name" | "projectId" | "counts">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirms deleting a module; its tasks stay in the project. */
export default function DeleteModuleDialog({
  module,
  open,
  onOpenChange,
  onDeleted,
}: DeleteModuleDialogProps) {
  const { t } = useTranslation();
  const deleteModule = useDeleteModule();

  const handleDelete = () => {
    deleteModule.mutate(
      { moduleId: module.id, projectId: module.projectId },
      {
        onSuccess: () => {
          toast.success(t("modules:toast.deleted"));
          onOpenChange(false);
          onDeleted?.();
        },
        onError: (error) => {
          toast.error(error.message || t("modules:toast.deleteError"));
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deleteModule.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("modules:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("modules:delete.description", {
              name: module.name,
              count: module.counts.total,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deleteModule.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("modules:delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deleteModule.isPending}
            onClick={handleDelete}
          >
            {t("modules:delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
