import { ChevronDown, CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { BatchImportResult } from "@/lib/task-import/batch";

export const MAX_LISTED_ISSUES = 50;

type CsvResultStepProps = {
  result: BatchImportResult;
  /** The CSV row number of each imported task, by its index. */
  rowNumbers: readonly number[];
};

/** Step 4: how many tasks were imported, and the first problems by row. */
export function CsvResultStep({ result, rowNumbers }: CsvResultStepProps) {
  const { t } = useTranslation();
  const issues = result.issues.slice(0, MAX_LISTED_ISSUES);

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5 text-sm">
        <li className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-4 text-success" />
          {t("settings:tasksImportExport.csv.result.imported", {
            count: result.successful,
          })}
        </li>
        {result.failed > 0 && (
          <li className="flex items-center gap-2 font-medium text-destructive-foreground">
            <CircleX className="size-4 text-destructive" />
            {t("settings:tasksImportExport.csv.result.failed", {
              count: result.failed,
            })}
          </li>
        )}
      </ul>

      {result.error && (
        <Alert variant="error">
          <CircleAlert />
          <AlertDescription>
            {t("settings:tasksImportExport.csv.result.stopped", {
              message: result.error,
            })}
          </AlertDescription>
        </Alert>
      )}

      {issues.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 font-medium text-sm">
            <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
            {t("settings:tasksImportExport.csv.result.details")}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm">
              {issues.map((issue) => (
                <li
                  key={`${issue.index}-${issue.kind}-${issue.message}`}
                  className={
                    issue.kind === "error"
                      ? "text-destructive-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {t("settings:tasksImportExport.csv.result.row", {
                    row: rowNumbers[issue.index] ?? issue.index + 1,
                    message: issue.message,
                  })}
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  );
}

export default CsvResultStep;
