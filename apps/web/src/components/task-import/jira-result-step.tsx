import {
  ChevronDown,
  CircleCheck,
  CircleX,
  RefreshCw,
  SkipForward,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { JiraImportResult } from "@/fetchers/jira-import/jira-import";

/**
 * Step 3: what the import did, then people, warnings and failed rows. Jira
 * speaks of issues; the other importers (Trello, Linear, Asana) of items.
 */
export function JiraResultStep({
  result,
  wording = "jira",
}: {
  result: JiraImportResult;
  wording?: "jira" | "external";
}) {
  const { t } = useTranslation();
  const jira = wording === "jira";

  return (
    <div className="space-y-4 text-sm">
      <ul className="space-y-1.5">
        <li className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-4 text-success" />
          {t("settings:tasksImportExport.jira.result.created", {
            count: result.created,
          })}
        </li>
        {result.updated > 0 && (
          <li className="flex items-center gap-2 font-medium">
            <RefreshCw className="size-4 text-muted-foreground" />
            {t("settings:tasksImportExport.jira.result.updated", {
              count: result.updated,
            })}
          </li>
        )}
        {result.skipped > 0 && (
          <li className="flex items-center gap-2">
            <SkipForward className="size-4 text-muted-foreground" />
            {jira
              ? t("settings:tasksImportExport.jira.result.skipped", {
                  count: result.skipped,
                })
              : t("settings:tasksImportExport.external.result.skipped", {
                  count: result.skipped,
                })}
          </li>
        )}
        {result.failed > 0 && (
          <li className="flex items-center gap-2 font-medium text-destructive-foreground">
            <CircleX className="size-4 text-destructive" />
            {jira
              ? t("settings:tasksImportExport.jira.result.failed", {
                  count: result.failed,
                })
              : t("settings:tasksImportExport.external.result.failed", {
                  count: result.failed,
                })}
          </li>
        )}
      </ul>

      <p className="text-muted-foreground">
        {t("settings:tasksImportExport.jira.result.extras", {
          comments: result.comments,
          relations: result.relations,
        })}
      </p>

      {result.unmatchedPeople.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">
            {jira
              ? t("settings:tasksImportExport.jira.result.unmatched", {
                  count: result.unmatchedPeople.length,
                })
              : t("settings:tasksImportExport.external.result.unmatched", {
                  count: result.unmatchedPeople.length,
                })}
          </p>
          <p className="text-muted-foreground">
            {result.unmatchedPeople.join(", ")}
          </p>
        </div>
      )}

      {(result.warnings.length > 0 || result.errors.length > 0) && (
        <Collapsible defaultOpen={result.errors.length > 0}>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 font-medium">
            <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180" />
            {t("settings:tasksImportExport.csv.result.details")}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
              {result.errors.map((error) => (
                <li
                  key={`${error.line}-${error.key}`}
                  className="text-destructive-foreground"
                >
                  {t("settings:tasksImportExport.jira.result.error", {
                    line: error.line,
                    key: error.key || "—",
                    message: error.message,
                  })}
                </li>
              ))}
              {result.warnings.map((warning) => (
                <li key={warning.message} className="text-muted-foreground">
                  {t("settings:tasksImportExport.jira.result.warning", {
                    message: warning.message,
                    count: warning.count,
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

export default JiraResultStep;
