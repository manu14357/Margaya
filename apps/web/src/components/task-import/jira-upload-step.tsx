import { ChevronDown, CircleAlert, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { JiraImportPreview } from "@/fetchers/jira-import/jira-import";
import { ImportDropZone } from "./import-drop-zone";

type JiraUploadStepProps = {
  fileName: string | null;
  isReading: boolean;
  error: string | null;
  preview: JiraImportPreview | null;
  onFile: (file: File) => void;
};

/** Step 1: how to export from Jira, the file, and what the server read. */
export function JiraUploadStep({
  fileName,
  isReading,
  error,
  preview,
  onFile,
}: JiraUploadStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p className="font-medium">
          {t("settings:tasksImportExport.jira.howToTitle")}
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>{t("settings:tasksImportExport.jira.howToStep1")}</li>
          <li>{t("settings:tasksImportExport.jira.howToStep2")}</li>
          <li>{t("settings:tasksImportExport.jira.howToStep3")}</li>
        </ol>
        <p className="text-muted-foreground">
          {t("settings:tasksImportExport.jira.limits")}
        </p>
      </div>

      <ImportDropZone
        accept=".csv,text/csv"
        hint={t("settings:tasksImportExport.jira.dropHint")}
        buttonLabel={
          fileName
            ? t("settings:tasksImportExport.csv.changeFile")
            : t("settings:tasksImportExport.csv.selectFile")
        }
        onFile={onFile}
        isBusy={isReading}
      />

      {isReading && (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t("settings:tasksImportExport.jira.reading")}
        </p>
      )}

      {error && (
        <Alert variant="error">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {fileName && preview && !isReading && (
        <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{fileName}</span>
            <span className="shrink-0 text-muted-foreground">
              {t("settings:tasksImportExport.jira.issueCount", {
                count: preview.issueCount,
              })}
            </span>
          </div>
          {preview.totals.alreadyImported > 0 && (
            <p className="text-muted-foreground">
              {t("settings:tasksImportExport.jira.alreadyImported", {
                count: preview.totals.alreadyImported,
              })}
            </p>
          )}
          <p className="text-muted-foreground">
            {t("settings:tasksImportExport.jira.contents", {
              comments: preview.totals.comments,
              subtasks: preview.totals.subtasks,
              links: preview.totals.links,
            })}
          </p>
          <Collapsible>
            <CollapsibleTrigger className="group inline-flex items-center gap-1 font-medium">
              <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
              {t("settings:tasksImportExport.jira.detectedColumns", {
                count: preview.columns.length,
              })}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ul className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {preview.columns.map((column) => (
                  <li
                    key={column.name}
                    className="rounded-md border border-border px-2 py-0.5 text-muted-foreground text-xs"
                  >
                    {column.count > 1
                      ? t("settings:tasksImportExport.jira.repeatedColumn", {
                          name: column.name,
                          count: column.count,
                        })
                      : column.name}
                  </li>
                ))}
              </ul>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

export default JiraUploadStep;
