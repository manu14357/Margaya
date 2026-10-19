import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
  useCreateAnalyticsReport,
  useUpdateAnalyticsReport,
} from "@/hooks/mutations/analytics-report/use-analytics-report-mutations";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type {
  AnalyticsReport,
  AnalyticsReportConfig,
  AnalyticsReportVisibility,
} from "@/types/analytics-report";

const NAME_MAX = 80;

/** The API's own message for a refused save (limit, missing project). */
export function reportErrorMessage(error: unknown): string | null {
  return error instanceof HttpError &&
    error.status < 500 &&
    error.message &&
    !error.message.startsWith("{")
    ? error.message
    : null;
}

type ReportFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Rename this report or change its visibility. */
  report?: AnalyticsReport;
  /** Create: the configuration to save. */
  config?: AnalyticsReportConfig;
  onSaved?: (report: AnalyticsReport) => void;
};

/** Save the chart as a report, or edit a report's name and visibility. */
export default function ReportFormDialog({
  open,
  onOpenChange,
  workspaceId,
  report,
  config,
  onSaved,
}: ReportFormDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const createReport = useCreateAnalyticsReport();
  const updateReport = useUpdateAnalyticsReport();
  const [name, setName] = useState("");
  const [visibility, setVisibility] =
    useState<AnalyticsReportVisibility>("private");
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = createReport.isPending || updateReport.isPending;

  useEffect(() => {
    if (!open) return;
    setName(report?.name ?? "");
    setVisibility(report?.visibility ?? "private");
    setError(null);
  }, [open, report]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("analytics:reports.dialog.nameRequired"));
      return;
    }
    const onError = (reason: Error) =>
      toast.error(
        reportErrorMessage(reason) ?? t("analytics:reports.toast.saveError"),
      );
    const onSuccess = (saved: AnalyticsReport) => {
      toast.success(
        report
          ? t("analytics:reports.toast.updated")
          : t("analytics:reports.toast.saved", { name: saved.name }),
      );
      onOpenChange(false);
      onSaved?.(saved);
    };

    if (report) {
      updateReport.mutate(
        { id: report.id, changes: { name: trimmed, visibility } },
        { onSuccess, onError },
      );
      return;
    }
    if (!config) return;
    createReport.mutate(
      { workspaceId, name: trimmed, visibility, config },
      { onSuccess, onError },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSubmitting && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {report
                ? t("analytics:reports.dialog.editTitle")
                : t("analytics:reports.dialog.createTitle")}
            </DialogTitle>
          </DialogHeader>

          <fieldset disabled={isSubmitting} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>
                {t("analytics:reports.dialog.name")}
              </Label>
              <Input
                id={`${id}-name`}
                autoFocus
                maxLength={NAME_MAX}
                value={name}
                placeholder={t("analytics:reports.dialog.namePlaceholder")}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              {error && (
                <p id={`${id}-error`} className="text-destructive text-sm">
                  {error}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p id={`${id}-visibility`} className="font-medium text-sm">
                {t("analytics:reports.dialog.visibility")}
              </p>
              <RadioGroup
                aria-labelledby={`${id}-visibility`}
                className="gap-2"
                value={visibility}
                onValueChange={(value) =>
                  setVisibility(value === "workspace" ? "workspace" : "private")
                }
              >
                {(["private", "workspace"] as const).map((option) => (
                  <label
                    key={option}
                    className="flex items-start gap-3"
                    htmlFor={`${id}-${option}`}
                  >
                    <Radio
                      className="mt-0.5"
                      id={`${id}-${option}`}
                      value={option}
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-sm">
                        {option === "private"
                          ? t("analytics:reports.visibility.private")
                          : t("analytics:reports.visibility.workspace")}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {option === "private"
                          ? t("analytics:reports.visibility.privateHint")
                          : t("analytics:reports.visibility.workspaceHint")}
                      </p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {!report && (
              <p className="text-muted-foreground text-xs">
                {t("analytics:reports.dialog.summary")}
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              {t("analytics:reports.dialog.cancel")}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {report
                ? t("analytics:reports.dialog.update")
                : t("analytics:reports.dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
