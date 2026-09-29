import { useEffect, useMemo } from "react";
import { Controller, type Resolver, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCycle } from "@/hooks/mutations/cycle/use-create-cycle";
import { useUpdateCycle } from "@/hooks/mutations/cycle/use-update-cycle";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { authClient } from "@/lib/auth-client";
import { toCycleDateString } from "@/lib/cycle/dates";
import {
  CYCLE_NAME_MAX,
  type CycleFormValues,
  createCyclePayload,
  updateCyclePayload,
  validateCycleForm,
} from "@/lib/cycle/form";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import CycleDateRangeField from "./cycle-date-range-field";
import CycleOwnerField from "./cycle-owner-field";

type CycleFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  /** Edits this cycle; creates a new one when absent. */
  cycle?: Cycle | null;
  onSaved?: (cycle: Cycle) => void;
};

function valuesOf(cycle: Cycle | null | undefined, userId?: string) {
  return {
    name: cycle?.name ?? "",
    description: cycle?.description ?? "",
    startDate: cycle?.startDate ?? null,
    endDate: cycle?.endDate ?? null,
    ownerId: cycle ? cycle.ownerId : (userId ?? null),
  } satisfies CycleFormValues;
}

/** Creates or edits a cycle: name, description, dates and owner. */
export default function CycleFormDialog({
  open,
  onOpenChange,
  projectId,
  workspaceId,
  cycle,
  onSaved,
}: CycleFormDialogProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const { data: cycles = [] } = useGetCycles(projectId, "all", {
    enabled: open,
  });
  const createCycle = useCreateCycle();
  const updateCycle = useUpdateCycle();
  const isEditing = Boolean(cycle);
  const isRunning = cycle?.status === "current";
  const today =
    cycle?.today ?? cycles[0]?.today ?? toCycleDateString(new Date());
  const original = useMemo(
    () => valuesOf(cycle, session?.user?.id),
    [cycle, session?.user?.id],
  );

  const resolver = useMemo<Resolver<CycleFormValues>>(
    () => async (values) => {
      const errors = validateCycleForm(values, {
        cycleId: cycle?.id,
        isRunning,
        today,
        otherCycles: cycles,
      });
      if (errors.length === 0) return { values, errors: {} };
      const fieldErrors: Record<string, { type: string; message: string }> = {};
      for (const error of errors) {
        const field = error.field === "dates" ? "startDate" : error.field;
        if (fieldErrors[field]) continue;
        fieldErrors[field] = {
          type: "validate",
          message:
            error.key === "cycles:form.errors.overlap"
              ? t(error.key, { name: error.name })
              : t(error.key),
        };
      }
      return { values: {}, errors: fieldErrors };
    },
    [cycle?.id, isRunning, today, cycles, t],
  );

  const form = useForm<CycleFormValues>({
    defaultValues: original,
    resolver,
  });
  const { errors, isSubmitting } = form.formState;
  const [startDate, endDate] = useWatch({
    control: form.control,
    name: ["startDate", "endDate"],
  });

  useEffect(() => {
    if (open) form.reset(original);
  }, [open, original, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (cycle) {
        const json = updateCyclePayload(values, original);
        const saved =
          Object.keys(json).length > 0
            ? await updateCycle.mutateAsync({
                cycleId: cycle.id,
                projectId,
                json,
              })
            : cycle;
        toast.success(t("cycles:toast.updated"));
        onSaved?.(saved);
      } else {
        const saved = await createCycle.mutateAsync({
          projectId,
          ...createCyclePayload(values),
        });
        toast.success(t("cycles:toast.created"));
        onSaved?.(saved);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("cycles:toast.saveError"),
      );
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSubmitting && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? t("cycles:form.editTitle")
                : t("cycles:form.createTitle")}
            </DialogTitle>
            {!isEditing && (
              <DialogDescription>
                {t("cycles:form.createDescription")}
              </DialogDescription>
            )}
          </DialogHeader>

          <fieldset disabled={isSubmitting} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor="cycle-name">{t("cycles:form.nameLabel")}</Label>
              <Input
                id="cycle-name"
                autoFocus
                maxLength={CYCLE_NAME_MAX}
                placeholder={t("cycles:form.namePlaceholder")}
                aria-invalid={errors.name ? true : undefined}
                {...form.register("name")}
              />
              {errors.name && (
                <p className="text-destructive text-sm">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle-description">
                {t("cycles:form.descriptionLabel")}
              </Label>
              <Textarea
                id="cycle-description"
                rows={3}
                placeholder={t("cycles:form.descriptionPlaceholder")}
                aria-invalid={errors.description ? true : undefined}
                {...form.register("description")}
              />
              {errors.description && (
                <p className="text-destructive text-sm">
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle-dates">{t("cycles:form.datesLabel")}</Label>
              <CycleDateRangeField
                id="cycle-dates"
                startDate={startDate}
                endDate={endDate}
                today={today}
                startLocked={isRunning}
                disabled={isSubmitting}
                invalid={Boolean(errors.startDate)}
                onChange={(range) => {
                  form.setValue("startDate", range.startDate);
                  form.setValue("endDate", range.endDate);
                  form.clearErrors("startDate");
                }}
              />
              {isRunning && (
                <p className="text-muted-foreground text-xs">
                  {t("cycles:form.startLocked")}
                </p>
              )}
              {errors.startDate && (
                <p className="text-destructive text-sm">
                  {errors.startDate.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle-owner">{t("cycles:form.ownerLabel")}</Label>
              <Controller
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <CycleOwnerField
                    id="cycle-owner"
                    workspaceId={workspaceId}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isSubmitting}
                  />
                )}
              />
            </div>
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              {t("cycles:form.cancel")}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isEditing ? t("cycles:form.save") : t("cycles:form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
