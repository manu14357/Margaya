import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EstimateRequestError } from "@/fetchers/estimate/estimate-error";
import { useCreateEstimatePoint } from "@/hooks/mutations/estimate/use-create-estimate-point";
import { useDeleteEstimatePoint } from "@/hooks/mutations/estimate/use-delete-estimate-point";
import { useReorderEstimatePoints } from "@/hooks/mutations/estimate/use-reorder-estimate-points";
import { useUpdateEstimatePoint } from "@/hooks/mutations/estimate/use-update-estimate-point";
import {
  formatEstimateValue,
  fromEstimateInput,
  toEstimateInput,
} from "@/lib/estimate/format";
import { estimateErrorKey } from "@/lib/estimate/messages";
import {
  MIN_ESTIMATE_POINTS,
  validateEstimateValue,
} from "@/lib/estimate/values";
import { toast } from "@/lib/toast";
import type { Estimate, EstimatePoint } from "@/types/estimate";
import DeletePointDialog from "./delete-point-dialog";
import EstimateAddPointRow from "./estimate-add-point-row";
import EstimatePointRow from "./estimate-point-row";
import { useDragOrder } from "./use-drag-order";

const NEW_ROW = "new";

type RemotePointListProps = {
  projectId: string;
  estimate: Estimate;
  canEdit: boolean;
};

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The values of a saved system in settings. Every change goes straight to
 * the API: edits save on blur or Enter, deleting a value that tasks use asks
 * where they go, and categories reorder by drag.
 */
export default function RemotePointList({
  projectId,
  estimate,
  canEdit,
}: RemotePointListProps) {
  const { t } = useTranslation();
  const createPoint = useCreateEstimatePoint();
  const updatePoint = useUpdateEstimatePoint();
  const deletePoint = useDeleteEstimatePoint();
  const reorderPoints = useReorderEstimatePoints();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    point: EstimatePoint;
    taskCount: number;
  } | null>(null);

  const { type } = estimate;
  const points = [...estimate.points].sort((a, b) => a.position - b.position);
  const pointById = new Map(points.map((point) => [point.id, point]));

  const drag = useDragOrder(
    points.map((point) => point.id),
    (pointIds) =>
      reorderPoints.mutate(
        { projectId, estimateId: estimate.id, pointIds },
        {
          onSuccess: () =>
            toast.success(t("settings:projectEstimates.toast.reordered")),
          onError: (error) =>
            toast.error(
              errorMessageOf(
                error,
                t("settings:projectEstimates.toast.reorderError"),
              ),
            ),
        },
      ),
  );

  const setError = (key: string, message: string | null) =>
    setErrors((current) => ({ ...current, [key]: message }));
  const clearDraft = (pointId: string) =>
    setDrafts(({ [pointId]: _dropped, ...rest }) => rest);
  const codeMessage = (code: Parameters<typeof estimateErrorKey>[1]) =>
    t(estimateErrorKey(type, code));

  /** The API's per-value code when it sent one, else a toast. */
  const reportFailure = (key: string, error: unknown, fallback: string) => {
    if (error instanceof EstimateRequestError && error.errors[0]) {
      setError(key, codeMessage(error.errors[0].code));
    } else {
      toast.error(errorMessageOf(error, fallback));
    }
  };

  const commitEdit = async (point: EstimatePoint) => {
    const draft = drafts[point.id];
    if (draft === undefined) return;
    const raw = fromEstimateInput(type, draft, t);
    const others = points.filter((other) => other.id !== point.id);
    const result = validateEstimateValue(type, raw, others);
    if (!result.ok) {
      setError(point.id, codeMessage(result.code));
      return;
    }
    setError(point.id, null);
    if (result.point.value === point.value) {
      clearDraft(point.id);
      return;
    }
    setSavingId(point.id);
    try {
      await updatePoint.mutateAsync({
        projectId,
        estimateId: estimate.id,
        pointId: point.id,
        value: raw,
      });
      clearDraft(point.id);
      toast.success(t("settings:projectEstimates.toast.updated"));
    } catch (error) {
      reportFailure(
        point.id,
        error,
        t("settings:projectEstimates.toast.updateError"),
      );
    } finally {
      setSavingId(null);
    }
  };

  const addPoint = async () => {
    const raw = fromEstimateInput(type, newValue, t);
    const result = validateEstimateValue(type, raw, points);
    if (!result.ok) {
      setError(NEW_ROW, codeMessage(result.code));
      return;
    }
    setError(NEW_ROW, null);
    setSavingId(NEW_ROW);
    try {
      await createPoint.mutateAsync({
        projectId,
        estimateId: estimate.id,
        value: raw,
      });
      setNewValue("");
      toast.success(t("settings:projectEstimates.toast.updated"));
    } catch (error) {
      reportFailure(
        NEW_ROW,
        error,
        t("settings:projectEstimates.toast.updateError"),
      );
    } finally {
      setSavingId(null);
    }
  };

  const removePoint = (point: EstimatePoint) => {
    if (point.taskCount > 0) {
      setDeleteTarget({ point, taskCount: point.taskCount });
      return;
    }
    setSavingId(point.id);
    deletePoint.mutate(
      { projectId, estimateId: estimate.id, pointId: point.id },
      {
        onSuccess: () =>
          toast.success(t("settings:projectEstimates.toast.pointDeleted")),
        onError: (error) => {
          // Tasks got this value since the list loaded: ask where they go.
          if (error instanceof EstimateRequestError && error.taskCount) {
            setDeleteTarget({ point, taskCount: error.taskCount });
            return;
          }
          toast.error(
            errorMessageOf(
              error,
              t("settings:projectEstimates.toast.pointDeleteError"),
            ),
          );
        },
        onSettled: () => setSavingId(null),
      },
    );
  };

  const canDelete = points.length > MIN_ESTIMATE_POINTS;

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {drag.order.map((pointId) => {
          const point = pointById.get(pointId);
          if (!point) return null;
          const label = formatEstimateValue(type, point.value, { t });
          return (
            <EstimatePointRow
              key={point.id}
              value={drafts[point.id] ?? toEstimateInput(type, point.value, t)}
              onChange={(text) => {
                setDrafts((current) => ({ ...current, [point.id]: text }));
                if (errors[point.id]) setError(point.id, null);
              }}
              onCommit={() => void commitEdit(point)}
              label={label}
              error={errors[point.id] ?? null}
              taskCount={point.taskCount}
              canEdit={canEdit}
              saving={savingId === point.id}
              canDelete={canDelete}
              onDelete={() => removePoint(point)}
              drag={
                type === "categories"
                  ? {
                      isDragging: drag.draggedId === point.id,
                      onDragStart: (event) => drag.start(event, point.id),
                      onDragOver: (event) => drag.over(event, point.id),
                      onDrop: drag.drop,
                      onDragEnd: drag.end,
                    }
                  : null
              }
            />
          );
        })}
      </ul>

      {canEdit && (
        <EstimateAddPointRow
          type={type}
          value={newValue}
          onChange={(text) => {
            setNewValue(text);
            if (errors[NEW_ROW]) setError(NEW_ROW, null);
          }}
          onAdd={() => void addPoint()}
          error={errors[NEW_ROW] ?? null}
          count={points.length}
          pending={savingId === NEW_ROW}
        />
      )}

      {deleteTarget && (
        <DeletePointDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          projectId={projectId}
          estimate={estimate}
          point={deleteTarget.point}
          taskCount={deleteTarget.taskCount}
        />
      )}
    </div>
  );
}
