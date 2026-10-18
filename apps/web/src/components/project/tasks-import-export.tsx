import { useNavigate } from "@tanstack/react-router";
import { saveAs } from "file-saver";
import {
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CsvImportDialog,
  isCsvFile,
} from "@/components/task-import/csv-import-dialog";
import { ExternalImportDialog } from "@/components/task-import/external-import-dialog";
import { ImportDropZone } from "@/components/task-import/import-drop-zone";
import { JiraImportDialog } from "@/components/task-import/jira-import-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import type { ExternalImportSource } from "@/fetchers/external-import/external-import";
import useExportTasks from "@/hooks/mutations/task/use-export-tasks";
import useImportTasks from "@/hooks/mutations/task/use-import-tasks";
import { useCreateTaskExport } from "@/hooks/mutations/task-export/use-create-task-export";
import { JSON_IMPORT_BATCH_SIZE } from "@/lib/task-import/batch";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";

type TasksImportExportProps = {
  project: ProjectWithTasks;
};

function isJsonFile(file: File) {
  return (
    file.type === "application/json" ||
    file.name.toLowerCase().endsWith(".json")
  );
}

const EXTERNAL_SOURCES = [
  {
    source: "trello",
    labelKey: "settings:tasksImportExport.external.sources.trello",
  },
  {
    source: "linear",
    labelKey: "settings:tasksImportExport.external.sources.linear",
  },
  {
    source: "asana",
    labelKey: "settings:tasksImportExport.external.sources.asana",
  },
] as const satisfies ReadonlyArray<{
  source: ExternalImportSource;
  labelKey: string;
}>;

export function TasksImportExport({ project }: TasksImportExportProps) {
  const { t } = useTranslation();
  const [isImportOpen, setIsImportOpen] = useState(false);
  // A CSV picked in the import dialog continues in the mapping dialog.
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isJiraOpen, setIsJiraOpen] = useState(false);
  const [externalSource, setExternalSource] =
    useState<ExternalImportSource | null>(null);

  const { mutateAsync: exportTasksMutation, isPending: isExporting } =
    useExportTasks();
  const { mutateAsync: importTasksMutation, isPending: isImporting } =
    useImportTasks();
  const createExport = useCreateTaskExport();
  const navigate = useNavigate();

  // CSV and Excel run as a background export of this project; the file
  // lands in Workspace settings → Exports.
  const handleAsyncExport = (format: "csv" | "xlsx") => {
    createExport.mutate(
      {
        workspaceId: project.workspaceId,
        format,
        projectIds: [project.id],
      },
      {
        onSuccess: () =>
          toast.success(t("settings:tasksImportExport.exportStarted"), {
            action: {
              label: t("settings:workspaceExports.viewExports"),
              onClick: () =>
                void navigate({ to: "/dashboard/settings/workspace/exports" }),
            },
          }),
        onError: (error) =>
          toast.error(
            error.message || t("settings:workspaceExports.toast.error"),
          ),
      },
    );
  };

  const handleExport = async () => {
    try {
      toast.loading(t("settings:tasksImportExport.exporting"));
      const exportData = await exportTasksMutation(project.id);

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });

      saveAs(blob, `${project.slug}-tasks-export.json`);

      toast.dismiss();
      toast.success(t("settings:tasksImportExport.exportSuccess"));
    } catch (error) {
      toast.dismiss();
      toast.error(t("settings:tasksImportExport.exportError"));
      console.error(error);
    }
  };

  // The JSON round-trip format, sent in batches of 500.
  const confirmImport = async (file: File) => {
    try {
      const content = await file.text();
      const jsonData = JSON.parse(content);

      if (!jsonData.tasks || !Array.isArray(jsonData.tasks)) {
        toast.error(t("settings:tasksImportExport.invalidFormat"));
        return;
      }

      toast.loading(t("settings:tasksImportExport.importing"));

      const result = await importTasksMutation({
        projectId: project.id,
        tasks: jsonData.tasks,
        batchSize: JSON_IMPORT_BATCH_SIZE,
      });

      setIsImportOpen(false);
      toast.dismiss();
      if (result.successful > 0 || !result.error) {
        toast.success(
          t("settings:tasksImportExport.importSuccess", {
            count: result.successful,
          }),
        );
      }

      if (result.error) {
        toast.error(
          t("settings:tasksImportExport.importStopped", {
            message: result.error,
          }),
        );
      }
      const rejected = result.failed - result.notSent;
      if (rejected > 0) {
        toast.error(
          t("settings:tasksImportExport.importPartialError", {
            count: rejected,
          }),
        );
      }
    } catch (error) {
      toast.dismiss();
      toast.error(t("settings:tasksImportExport.importError"));
      console.error(error);
    }
  };

  const handleFile = (file: File) => {
    if (isCsvFile(file)) {
      setIsImportOpen(false);
      setCsvFile(file);
    } else if (isJsonFile(file)) {
      void confirmImport(file);
    } else {
      toast.error(t("settings:tasksImportExport.unsupportedFile"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={isExporting || createExport.isPending}
              />
            }
          >
            {isExporting || createExport.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Download />
            )}
            {t("settings:tasksImportExport.exportTasks")}
            <ChevronDown className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => void handleExport()}>
              <FileJson />
              {t("settings:tasksImportExport.exportJson")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAsyncExport("csv")}>
              <FileText />
              {t("settings:tasksImportExport.exportCsv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAsyncExport("xlsx")}>
              <FileSpreadsheet />
              {t("settings:tasksImportExport.exportXlsx")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsImportOpen(true)}
        >
          <Upload />
          {t("settings:tasksImportExport.importTasks")}
        </Button>
      </div>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogPopup className="w-full max-w-md">
          <div className="bg-card rounded-lg shadow-xl border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <DialogTitle className="text-lg font-semibold text-foreground">
                {t("settings:tasksImportExport.dialogTitle")}
              </DialogTitle>
            </div>

            <div className="p-4">
              <p className="text-sm text-muted-foreground mb-2">
                {t("settings:tasksImportExport.importAcceptHint")}
              </p>

              <div className="mb-4 p-3 bg-muted rounded-md border border-border/50 font-mono text-sm">
                <p className="text-muted-foreground mb-1 text-xs">
                  {t("settings:tasksImportExport.expectedFormat")}
                </p>
                <pre className="text-foreground overflow-auto max-h-32 text-xs">
                  {`{
  "tasks": [
    {
      "title": "Task title",
      "description": "Description text",
      "status": "to-do",
      "priority": "low",
      "startDate": "2025-04-18T00:00:00.000Z",
      "dueDate": "2025-04-20T00:00:00.000Z",
      "assigneeIds": ["<member user id>"]
    }
  ]
}`}
                </pre>
              </div>

              <div className="mb-4">
                <ImportDropZone
                  accept=".json,application/json,.csv,text/csv"
                  hint={t("settings:tasksImportExport.dropHintAny")}
                  buttonLabel={t("settings:tasksImportExport.selectFile")}
                  onFile={handleFile}
                  onEmptyDrop={() =>
                    toast.error(t("settings:tasksImportExport.noFileDropped"))
                  }
                  isBusy={isImporting}
                />
              </div>

              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings:tasksImportExport.jira.sourceHint")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setIsImportOpen(false);
                    setIsJiraOpen(true);
                  }}
                >
                  {t("settings:tasksImportExport.jira.source")}
                </Button>
              </div>

              <div className="mb-4 space-y-2 rounded-md border border-border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings:tasksImportExport.external.sourceHint")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXTERNAL_SOURCES.map(({ source, labelKey }) => (
                    <Button
                      key={source}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsImportOpen(false);
                        setExternalSource(source);
                      }}
                    >
                      {t(labelKey)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <DialogClose
                  render={
                    <Button className="bg-card hover:bg-accent text-foreground border border-border" />
                  }
                >
                  {t("common:actions.cancel")}
                </DialogClose>
              </div>
            </div>
          </div>
        </DialogPopup>
      </Dialog>

      <CsvImportDialog
        open={csvFile !== null}
        onOpenChange={(open) => {
          if (!open) setCsvFile(null);
        }}
        project={project}
        initialFile={csvFile}
      />

      <JiraImportDialog
        open={isJiraOpen}
        onOpenChange={setIsJiraOpen}
        project={project}
      />

      <ExternalImportDialog
        source={externalSource}
        onOpenChange={(open) => {
          if (!open) setExternalSource(null);
        }}
        project={project}
      />
    </div>
  );
}
