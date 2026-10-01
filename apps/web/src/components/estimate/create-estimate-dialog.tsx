import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type EstimateTemplate,
  resolveTemplateValues,
} from "@/constants/estimate-templates";
import { EstimateRequestError } from "@/fetchers/estimate/estimate-error";
import { useCreateEstimate } from "@/hooks/mutations/estimate/use-create-estimate";
import { fromEstimateInput, toEstimateInput } from "@/lib/estimate/format";
import {
  ESTIMATE_TYPE_LABEL_KEYS,
  estimateErrorKey,
} from "@/lib/estimate/messages";
import {
  type EstimateType,
  MAX_ESTIMATE_NAME_LENGTH,
  validateEstimateValues,
} from "@/lib/estimate/values";
import { toast } from "@/lib/toast";
import type { Estimate } from "@/types/estimate";
import CreateEstimateChooseStep from "./create-estimate-choose-step";
import DiscardEstimateDialog from "./discard-estimate-dialog";
import LocalPointList, {
  type LocalPointRow,
  newLocalRow,
} from "./local-point-list";

type CreateEstimateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The project's systems, for the name check. */
  existingNames: readonly string[];
  onCreated: (estimate: Estimate) => void;
};

type Draft = { name: string; rows: LocalPointRow[] };

/**
 * Creates an estimate system in two steps: pick a type and a template (or
 * start from scratch), then name it and edit its values. While there are
 * unsaved edits, Escape and the backdrop ask before discarding them.
 */
export default function CreateEstimateDialog({
  open,
  onOpenChange,
  projectId,
  existingNames,
  onCreated,
}: CreateEstimateDialogProps) {
  const { t } = useTranslation();
  const createEstimate = useCreateEstimate();
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<EstimateType>("points");
  const [draft, setDraft] = useState<Draft>({ name: "", rows: [] });
  const [initial, setInitial] = useState<Draft>({ name: "", rows: [] });
  const [serverErrors, setServerErrors] = useState<Map<number, string>>(
    new Map(),
  );
  const [nameTaken, setNameTaken] = useState(false);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setType("points");
    setServerErrors(new Map());
    setNameTaken(false);
  }, [open]);

  const values = useMemo(
    () => draft.rows.map((row) => fromEstimateInput(type, row.text, t)),
    [draft.rows, type, t],
  );
  const validation = useMemo(
    () => validateEstimateValues(type, values),
    [type, values],
  );
  const rowErrors = useMemo(() => {
    const errors = new Map<number, string>();
    for (const error of validation.errors) {
      if (error.index >= 0 && !errors.has(error.index)) {
        errors.set(error.index, t(estimateErrorKey(type, error.code)));
      }
    }
    for (const [index, message] of serverErrors) {
      if (!errors.has(index)) errors.set(index, message);
    }
    return errors;
  }, [validation, serverErrors, type, t]);
  const countError = validation.errors.find((error) => error.index === -1);

  const name = draft.name.trim();
  const nameError =
    name === ""
      ? t("settings:projectEstimates.validation.name_required")
      : name.length > MAX_ESTIMATE_NAME_LENGTH
        ? t("settings:projectEstimates.validation.name_too_long")
        : nameTaken ||
            existingNames.some(
              (existing) =>
                existing.trim().toLowerCase() === name.toLowerCase(),
            )
          ? t("settings:projectEstimates.validation.name_taken")
          : null;

  const isDirty =
    step === 2 &&
    (draft.name !== initial.name ||
      draft.rows.map((row) => row.text).join("\n") !==
        initial.rows.map((row) => row.text).join("\n"));
  const canSubmit =
    step === 2 &&
    validation.ok &&
    rowErrors.size === 0 &&
    nameError === null &&
    !createEstimate.isPending;

  const pickTemplate = (template: EstimateTemplate) => {
    const next: Draft = {
      name: template.titleKey
        ? t(template.titleKey)
        : t(ESTIMATE_TYPE_LABEL_KEYS[template.type]),
      rows: resolveTemplateValues(template, t).map((value) =>
        newLocalRow(toEstimateInput(template.type, value, t)),
      ),
    };
    setDraft(next);
    setInitial(next);
    setServerErrors(new Map());
    setNameTaken(false);
    setStep(2);
  };

  const requestClose = () => {
    if (createEstimate.isPending) return;
    if (isDirty) {
      setIsDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const created = await createEstimate.mutateAsync({
        projectId,
        name,
        type,
        values,
      });
      toast.success(t("settings:projectEstimates.toast.created"));
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      if (error instanceof EstimateRequestError && error.errors.length > 0) {
        setServerErrors(
          new Map(
            error.errors
              .filter((entry) => entry.index >= 0)
              .map((entry) => [
                entry.index,
                t(estimateErrorKey(type, entry.code)),
              ]),
          ),
        );
        return;
      }
      if (error instanceof EstimateRequestError && error.status === 409) {
        setNameTaken(true);
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:projectEstimates.toast.createError"),
      );
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {step === 2 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 size-7"
                  aria-label={t("settings:projectEstimates.create.back")}
                  onClick={() => setStep(1)}
                  disabled={createEstimate.isPending}
                >
                  <ChevronLeft />
                </Button>
              )}
              <DialogTitle>
                {t("settings:projectEstimates.create.title")}
              </DialogTitle>
            </div>
            <DialogDescription>
              {t("settings:projectEstimates.create.description")}
            </DialogDescription>
            <p className="text-muted-foreground text-xs">
              {t("settings:projectEstimates.create.step", {
                step,
                total: 2,
              })}
            </p>
          </DialogHeader>

          <DialogPanel>
            {step === 1 ? (
              <CreateEstimateChooseStep
                type={type}
                onTypeChange={setType}
                onPick={pickTemplate}
              />
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="estimate-name">
                    {t("settings:projectEstimates.name.label")}
                  </Label>
                  <Input
                    id="estimate-name"
                    value={draft.name}
                    maxLength={MAX_ESTIMATE_NAME_LENGTH}
                    placeholder={t(
                      "settings:projectEstimates.name.placeholder",
                    )}
                    aria-invalid={nameError ? true : undefined}
                    disabled={createEstimate.isPending}
                    onChange={(event) => {
                      const next = event.target.value;
                      setNameTaken(false);
                      setDraft((current) => ({ ...current, name: next }));
                    }}
                  />
                  {nameError && (
                    <p className="text-destructive text-xs">{nameError}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t("settings:projectEstimates.values.label")}</Label>
                  <LocalPointList
                    type={type}
                    rows={draft.rows}
                    onRowsChange={(rows) => {
                      setServerErrors(new Map());
                      setDraft((current) => ({ ...current, rows }));
                    }}
                    rowErrors={rowErrors}
                    disabled={createEstimate.isPending}
                  />
                  {countError && (
                    <p className="text-destructive text-xs">
                      {t(estimateErrorKey(type, countError.code))}
                    </p>
                  )}
                </div>
              </div>
            )}
          </DialogPanel>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={createEstimate.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            {step === 2 && (
              <Button
                disabled={!canSubmit}
                loading={createEstimate.isPending}
                onClick={() => void submit()}
              >
                {createEstimate.isPending
                  ? t("settings:projectEstimates.create.submitting")
                  : t("settings:projectEstimates.create.submit")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DiscardEstimateDialog
        open={isDiscardOpen}
        onOpenChange={setIsDiscardOpen}
        onDiscard={() => {
          setIsDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
