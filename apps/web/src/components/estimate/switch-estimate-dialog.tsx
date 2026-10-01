import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActivateEstimate } from "@/hooks/mutations/estimate/use-activate-estimate";
import { formatEstimateValue } from "@/lib/estimate/format";
import { defaultEstimateMapping } from "@/lib/estimate/mapping";
import { toast } from "@/lib/toast";
import type { Estimate } from "@/types/estimate";

// The Select's value for "No estimate"; point ids are never this.
const CLEAR = "clear";

type SwitchEstimateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The active system, or null when the project has none. */
  current: Estimate | null;
  target: Estimate;
};

/**
 * Switches the project to another system. Each current value that tasks use
 * maps to a value of the new system (or to no estimate); the defaults keep
 * equal values, then the closest, then the same rank.
 */
export default function SwitchEstimateDialog({
  open,
  onOpenChange,
  projectId,
  current,
  target,
}: SwitchEstimateDialogProps) {
  const { t } = useTranslation();
  const activate = useActivateEstimate();
  const [mapping, setMapping] = useState<Record<string, string | null>>({});

  // Defaults are computed when the dialog opens, not on every refetch, so a
  // background refresh never undoes the choices made so far.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per opening
  useEffect(() => {
    if (open) {
      setMapping(current ? defaultEstimateMapping(current, target) : {});
    }
  }, [open, current?.id, target.id]);

  const rows = current
    ? [...current.points]
        .filter((point) => point.taskCount > 0)
        .sort((a, b) => a.position - b.position)
    : [];
  const taskCount = rows.reduce((sum, point) => sum + point.taskCount, 0);
  const targetPoints = [...target.points].sort(
    (a, b) => a.position - b.position,
  );
  const formatTarget = (value: string) =>
    formatEstimateValue(target.type, value, { withUnit: true, t });
  const labelOf = (pointId: string | null) => {
    const point = targetPoints.find((candidate) => candidate.id === pointId);
    return point
      ? formatTarget(point.value)
      : t("settings:projectEstimates.switch.clearOption");
  };

  const handleSwitch = () => {
    activate.mutate(
      {
        projectId,
        estimateId: target.id,
        mapping: rows.map((point) => ({
          fromPointId: point.id,
          toPointId: mapping[point.id] ?? null,
        })),
      },
      {
        onSuccess: () => {
          toast.success(t("settings:projectEstimates.toast.switched"));
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error.message || t("settings:projectEstimates.toast.switchError"),
          );
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !activate.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("settings:projectEstimates.switch.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings:projectEstimates.switch.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {rows.length === 0 || !current ? (
            <p className="text-muted-foreground text-sm">
              {t("settings:projectEstimates.switch.noTasks")}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_1fr] gap-2 font-medium text-muted-foreground text-xs">
                <span>{t("settings:projectEstimates.switch.fromLabel")}</span>
                <span />
                <span>{t("settings:projectEstimates.switch.toLabel")}</span>
              </div>
              {rows.map((point) => {
                const from = formatEstimateValue(current.type, point.value, {
                  withUnit: true,
                  t,
                });
                const selected = mapping[point.id] ?? null;
                return (
                  <div
                    key={point.id}
                    className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
                  >
                    <span className="truncate text-sm">
                      {from}
                      <span className="text-muted-foreground">
                        {" · "}
                        {t("settings:projectEstimates.switch.rowTasks", {
                          count: point.taskCount,
                        })}
                      </span>
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <Select
                      value={selected ?? CLEAR}
                      onValueChange={(value) =>
                        setMapping((currentMapping) => ({
                          ...currentMapping,
                          [point.id]:
                            typeof value === "string" && value !== CLEAR
                              ? value
                              : null,
                        }))
                      }
                      disabled={activate.isPending}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t(
                          "settings:projectEstimates.switch.targetAria",
                          { value: from },
                        )}
                      >
                        <SelectValue>{labelOf(selected)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {targetPoints.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {formatTarget(option.value)}
                          </SelectItem>
                        ))}
                        <SelectItem value={CLEAR}>
                          {t("settings:projectEstimates.switch.clearOption")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={activate.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button loading={activate.isPending} onClick={handleSwitch}>
            {taskCount > 0
              ? t("settings:projectEstimates.switch.submitWithTasks", {
                  count: taskCount,
                })
              : t("settings:projectEstimates.switch.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
