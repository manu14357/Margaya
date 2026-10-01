import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeleteEstimatePoint } from "@/hooks/mutations/estimate/use-delete-estimate-point";
import { formatEstimateValue } from "@/lib/estimate/format";
import { nearestPointId } from "@/lib/estimate/mapping";
import { toast } from "@/lib/toast";
import type { Estimate, EstimatePoint } from "@/types/estimate";

// The Select's value for "Clear their estimate"; point ids are never this.
const CLEAR = "clear";

type DeletePointDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  estimate: Estimate;
  point: EstimatePoint;
  /** Tasks on the value right now. */
  taskCount: number;
};

/**
 * Deleting a value that tasks use: move them to another value (the nearest
 * one by default) or clear their estimate.
 */
export default function DeletePointDialog({
  open,
  onOpenChange,
  projectId,
  estimate,
  point,
  taskCount,
}: DeletePointDialogProps) {
  const { t } = useTranslation();
  const deletePoint = useDeleteEstimatePoint();
  const [target, setTarget] = useState<string>(
    () => nearestPointId(estimate.points, point.id) ?? CLEAR,
  );
  const others = [...estimate.points]
    .filter((other) => other.id !== point.id)
    .sort((a, b) => a.position - b.position);
  const format = (value: string) =>
    formatEstimateValue(estimate.type, value, { withUnit: true, t });
  const labelOf = (value: string) => {
    if (value === CLEAR)
      return t("settings:projectEstimates.deletePoint.clear");
    const other = others.find((candidate) => candidate.id === value);
    return other ? format(other.value) : "";
  };

  const handleDelete = () => {
    deletePoint.mutate(
      {
        projectId,
        estimateId: estimate.id,
        pointId: point.id,
        outcome:
          target === CLEAR ? { clear: true } : { replacementPointId: target },
      },
      {
        onSuccess: () => {
          toast.success(t("settings:projectEstimates.toast.pointDeleted"));
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error.message ||
              t("settings:projectEstimates.toast.pointDeleteError"),
          );
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deletePoint.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectEstimates.deletePoint.title", {
              value: format(point.value),
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings:projectEstimates.deletePoint.description", {
              count: taskCount,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 px-6 pb-6">
          <Label htmlFor="estimate-delete-target">
            {t("settings:projectEstimates.deletePoint.moveTo")}
          </Label>
          <Select
            value={target}
            onValueChange={(value) => {
              if (typeof value === "string") setTarget(value);
            }}
            disabled={deletePoint.isPending}
          >
            <SelectTrigger id="estimate-delete-target">
              <SelectValue>{labelOf(target)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {others.map((other) => (
                <SelectItem key={other.id} value={other.id}>
                  {format(other.value)}
                </SelectItem>
              ))}
              <SelectItem value={CLEAR}>
                {t("settings:projectEstimates.deletePoint.clear")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deletePoint.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deletePoint.isPending}
            onClick={handleDelete}
          >
            {t("settings:projectEstimates.deletePoint.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
