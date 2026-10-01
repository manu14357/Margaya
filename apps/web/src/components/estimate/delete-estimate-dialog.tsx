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
import { useDeleteEstimate } from "@/hooks/mutations/estimate/use-delete-estimate";
import { toast } from "@/lib/toast";
import type { Estimate } from "@/types/estimate";

type DeleteEstimateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  estimate: Estimate;
};

/**
 * Confirms deleting a system. The active one takes its tasks' estimates with
 * it, and no other system becomes active; an inactive one has no tasks.
 */
export default function DeleteEstimateDialog({
  open,
  onOpenChange,
  projectId,
  estimate,
}: DeleteEstimateDialogProps) {
  const { t } = useTranslation();
  const deleteEstimate = useDeleteEstimate();
  const taskCount = estimate.points.reduce(
    (sum, point) => sum + point.taskCount,
    0,
  );

  const description = !estimate.isActive
    ? t("settings:projectEstimates.deleteSystem.descriptionInactive")
    : taskCount > 0
      ? t("settings:projectEstimates.deleteSystem.descriptionActive", {
          count: taskCount,
        })
      : t("settings:projectEstimates.deleteSystem.descriptionActiveNone");

  const handleDelete = () => {
    deleteEstimate.mutate(
      { projectId, estimateId: estimate.id },
      {
        onSuccess: () => {
          toast.success(t("settings:projectEstimates.toast.deleted"));
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error.message || t("settings:projectEstimates.toast.deleteError"),
          );
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deleteEstimate.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectEstimates.deleteSystem.title", {
              name: estimate.name,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deleteEstimate.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deleteEstimate.isPending}
            onClick={handleDelete}
          >
            {t("settings:projectEstimates.deleteSystem.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
