import { type FormEvent, useEffect, useId, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useCreateWorkspaceExport } from "@/hooks/mutations/task-export/use-create-workspace-export";
import { toast } from "@/lib/toast";

type WorkspaceExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
};

/** Starts an export of the whole workspace, with or without its files. */
export function WorkspaceExportDialog({
  open,
  onOpenChange,
  workspaceId,
}: WorkspaceExportDialogProps) {
  const { t } = useTranslation();
  const filesId = useId();
  const [includeFiles, setIncludeFiles] = useState(true);
  const createExport = useCreateWorkspaceExport();
  const isPending = createExport.isPending;

  // Each opening starts from the default.
  useEffect(() => {
    if (open) setIncludeFiles(true);
  }, [open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    createExport.mutate(
      { workspaceId, includeFiles },
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
          <DialogTitle>
            {t("settings:workspaceExports.whole.dialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workspaceExports.whole.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor={filesId}>
                  {t("settings:workspaceExports.whole.includeFiles")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("settings:workspaceExports.whole.includeFilesHint")}
                </p>
              </div>
              <Switch
                id={filesId}
                checked={includeFiles}
                disabled={isPending}
                onCheckedChange={(checked) => setIncludeFiles(checked)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {t("settings:workspaceExports.whole.leftOut")}
            </p>
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
            <Button type="submit" disabled={isPending}>
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

export default WorkspaceExportDialog;
