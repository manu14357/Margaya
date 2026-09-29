import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCreateTaskExport } from "@/hooks/mutations/task-export/use-create-task-export";
import { useExportProjects } from "@/hooks/queries/task-export/use-export-projects";
import {
  buildExportInput,
  canSplitByProject,
  TASK_EXPORT_FORMATS,
} from "@/lib/task-export/form";
import { toast } from "@/lib/toast";
import type { TaskExportFormat } from "@/types/task-export";
import {
  type ExportProjectOption,
  ExportProjectSelect,
} from "./export-project-select";

const FORMAT_LABEL_KEYS = {
  csv: "settings:workspaceExports.form.formatCsv",
  xlsx: "settings:workspaceExports.form.formatXlsx",
  json: "settings:workspaceExports.form.formatJson",
} as const satisfies Record<TaskExportFormat, string>;

type ExportFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
};

/** "New export": projects, format, one file per project, archived tasks. */
export function ExportFormDialog({
  open,
  onOpenChange,
  workspaceId,
}: ExportFormDialogProps) {
  const { t } = useTranslation();
  const projectsId = useId();
  const formatId = useId();
  const splitId = useId();
  const archivedId = useId();
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [format, setFormat] = useState<TaskExportFormat>("csv");
  const [split, setSplit] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(true);
  const { data: projectList, isLoading: isLoadingProjects } = useExportProjects(
    workspaceId,
    { enabled: open },
  );
  const createExport = useCreateTaskExport();

  // Each opening starts from the defaults.
  useEffect(() => {
    if (!open) return;
    setProjectIds([]);
    setFormat("csv");
    setSplit(false);
    setIncludeArchived(true);
  }, [open]);

  const projects = useMemo<ExportProjectOption[]>(
    () =>
      (projectList ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        icon: project.icon ?? null,
        archivedAt: project.archivedAt ?? null,
      })),
    [projectList],
  );
  const activeProjectCount = projects.filter(
    (project) => !project.archivedAt,
  ).length;
  // Ids of projects deleted while the dialog was open are dropped.
  const selection = projectIds.filter((id) =>
    projects.some((project) => project.id === id),
  );
  const splitAllowed = canSplitByProject(selection.length, activeProjectCount);
  const isPending = createExport.isPending;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    createExport.mutate(
      buildExportInput({
        workspaceId,
        format,
        projectIds: selection,
        split,
        includeArchived,
        activeProjectCount,
      }),
      {
        onSuccess: () => {
          toast.success(t("settings:workspaceExports.toast.started"));
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(
            error.message || t("settings:workspaceExports.toast.error"),
          ),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-6 py-5 border-b border-border">
          <DialogTitle>{t("settings:workspaceExports.form.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:workspaceExports.form.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor={projectsId}>
                {t("settings:workspaceExports.form.projects")}
              </Label>
              <ExportProjectSelect
                id={projectsId}
                projects={projects}
                selected={selection}
                onChange={setProjectIds}
                disabled={isPending || isLoadingProjects}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={formatId}>
                {t("settings:workspaceExports.form.format")}
              </Label>
              <Select
                value={format}
                onValueChange={(value) => {
                  if (value) setFormat(value as TaskExportFormat);
                }}
                disabled={isPending}
              >
                <SelectTrigger id={formatId}>
                  <SelectValue>{t(FORMAT_LABEL_KEYS[format])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TASK_EXPORT_FORMATS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(FORMAT_LABEL_KEYS[option])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor={splitId}>
                  {t("settings:workspaceExports.form.split")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("settings:workspaceExports.form.splitHint")}
                </p>
              </div>
              <Switch
                id={splitId}
                checked={split && splitAllowed}
                disabled={!splitAllowed || isPending}
                onCheckedChange={(checked) => setSplit(checked)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={archivedId}>
                {t("settings:workspaceExports.form.includeArchived")}
              </Label>
              <Switch
                id={archivedId}
                checked={includeArchived}
                disabled={isPending}
                onCheckedChange={(checked) => setIncludeArchived(checked)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={isPending || isLoadingProjects}>
              {isPending
                ? t("settings:workspaceExports.form.submitting")
                : t("settings:workspaceExports.form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ExportFormDialog;
