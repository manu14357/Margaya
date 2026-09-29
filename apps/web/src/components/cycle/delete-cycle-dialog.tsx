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
import { useDeleteCycle } from "@/hooks/mutations/cycle/use-delete-cycle";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";

type DeleteCycleDialogProps = {
  cycle: Pick<Cycle, "id" | "name" | "projectId" | "counts">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirms deleting a cycle; its tasks stay in the project. */
export default function DeleteCycleDialog({
  cycle,
  open,
  onOpenChange,
  onDeleted,
}: DeleteCycleDialogProps) {
  const { t } = useTranslation();
  const deleteCycle = useDeleteCycle();

  const handleDelete = () => {
    deleteCycle.mutate(
      { cycleId: cycle.id, projectId: cycle.projectId },
      {
        onSuccess: () => {
          toast.success(t("cycles:toast.deleted"));
          onOpenChange(false);
          onDeleted?.();
        },
        onError: (error) => {
          toast.error(error.message || t("cycles:toast.deleteError"));
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deleteCycle.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cycles:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("cycles:delete.description", {
              name: cycle.name,
              count: cycle.counts.total,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deleteCycle.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("cycles:delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deleteCycle.isPending}
            onClick={handleDelete}
          >
            {t("cycles:delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
