import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
} from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportDateFormat } from "@/lib/task-import/csv-dates";
import type { ImportField, ResolveResult } from "@/lib/task-import/csv-mapping";
import { FIELD_LABEL_KEYS } from "./field-labels";

const DATE_FORMAT_LABEL_KEYS = {
  auto: "settings:tasksImportExport.csv.dateFormatAuto",
  mdy: "settings:tasksImportExport.csv.dateFormatMdy",
  dmy: "settings:tasksImportExport.csv.dateFormatDmy",
} as const satisfies Record<ImportDateFormat, string>;

const DATE_FORMATS = Object.keys(DATE_FORMAT_LABEL_KEYS) as ImportDateFormat[];

type CsvReviewStepProps = {
  result: ResolveResult;
  /** Mapped fields, in field order: the preview's columns. */
  previewFields: readonly ImportField[];
  /** Up to five rows of raw values, one per preview field. */
  previewRows: ReadonlyArray<{ row: number; values: string[] }>;
  showDateFormat: boolean;
  dateFormat: ImportDateFormat;
  onDateFormatChange: (format: ImportDateFormat) => void;
  progress: { done: number; total: number } | null;
};

/** Step 3: what will happen, a preview, and the progress while importing. */
export function CsvReviewStep({
  result,
  previewFields,
  previewRows,
  showDateFormat,
  dateFormat,
  onDateFormatChange,
  progress,
}: CsvReviewStepProps) {
  const { t } = useTranslation();
  const dateFormatId = useId();
  const { unmatched } = result;

  const notes = [
    [
      "settings:tasksImportExport.csv.review.unmatchedStatus",
      unmatched.status.length,
    ],
    [
      "settings:tasksImportExport.csv.review.unmatchedAssignee",
      unmatched.assignees.length,
    ],
    [
      "settings:tasksImportExport.csv.review.newLabels",
      result.newLabels.length,
    ],
    [
      "settings:tasksImportExport.csv.review.unmatchedCycle",
      unmatched.cycle.length,
    ],
    [
      "settings:tasksImportExport.csv.review.unmatchedModule",
      unmatched.modules.length,
    ],
    [
      "settings:tasksImportExport.csv.review.unmatchedEstimate",
      unmatched.estimate.length,
    ],
    [
      "settings:tasksImportExport.csv.review.invalidDate",
      unmatched.dates.length,
    ],
  ] as const;

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5 text-sm">
        <li className="flex items-center gap-2 font-medium">
          <CircleCheck className="size-4 text-success" />
          {t("settings:tasksImportExport.csv.review.willImport", {
            count: result.tasks.length,
          })}
        </li>
        {result.skipped.length > 0 && (
          <li className="flex items-center gap-2 text-muted-foreground">
            <CircleAlert className="size-4 text-warning" />
            {t("settings:tasksImportExport.csv.review.skipped", {
              count: result.skipped.length,
            })}
          </li>
        )}
        {notes.map(([note, count]) =>
          count > 0 ? (
            <li
              key={note}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <Info className="size-4 text-info" />
              {t(note, { count })}
            </li>
          ) : null,
        )}
      </ul>

      {showDateFormat && (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={dateFormatId}>
            {t("settings:tasksImportExport.csv.dateFormat")}
          </Label>
          <Select
            value={dateFormat}
            onValueChange={(value) => {
              if (value) onDateFormatChange(value as ImportDateFormat);
            }}
            disabled={progress !== null}
          >
            <SelectTrigger id={dateFormatId} className="w-48">
              <SelectValue>{t(DATE_FORMAT_LABEL_KEYS[dateFormat])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {t(DATE_FORMAT_LABEL_KEYS[format])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-sm">
            {t("settings:tasksImportExport.csv.review.preview")}
          </p>
          <div className="max-h-56 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {previewFields.map((field) => (
                    <TableHead key={field}>
                      {t(FIELD_LABEL_KEYS[field])}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map(({ row, values }) => (
                  <TableRow key={row}>
                    {values.map((value, index) => (
                      <TableCell
                        key={previewFields[index]}
                        className="max-w-40 truncate"
                      >
                        {value}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {progress && (
        <Progress
          value={
            progress.total > 0
              ? Math.round((progress.done / progress.total) * 100)
              : 0
          }
        >
          <ProgressLabel className="text-sm">
            {t("settings:tasksImportExport.csv.importing", {
              done: progress.done,
              total: progress.total,
            })}
          </ProgressLabel>
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
      )}
    </div>
  );
}

export default CsvReviewStep;
