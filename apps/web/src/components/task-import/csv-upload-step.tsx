import { CircleAlert, FileText, Loader2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CSV_DELIMITERS, type CsvDelimiter } from "@/lib/task-import/csv-parse";
import { ImportDropZone } from "./import-drop-zone";

const DELIMITER_LABEL_KEYS = {
  ",": "settings:tasksImportExport.csv.delimiterComma",
  ";": "settings:tasksImportExport.csv.delimiterSemicolon",
  "\t": "settings:tasksImportExport.csv.delimiterTab",
} as const satisfies Record<CsvDelimiter, string>;

// Select values can't hold a tab character reliably, so options use names.
const DELIMITER_VALUES = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
} as const satisfies Record<CsvDelimiter, string>;

type CsvUploadStepProps = {
  fileName: string | null;
  rowCount: number | null;
  isReading: boolean;
  error: string | null;
  /** The delimiter in use (detected or chosen), once a file is loaded. */
  delimiter: CsvDelimiter | null;
  onDelimiterChange: (delimiter: CsvDelimiter) => void;
  hasHeader: boolean;
  onHasHeaderChange: (hasHeader: boolean) => void;
  onFile: (file: File) => void;
};

/** Step 1: pick a CSV file, then confirm its delimiter and header row. */
export function CsvUploadStep({
  fileName,
  rowCount,
  isReading,
  error,
  delimiter,
  onDelimiterChange,
  hasHeader,
  onHasHeaderChange,
  onFile,
}: CsvUploadStepProps) {
  const { t } = useTranslation();
  const delimiterId = useId();
  const headerId = useId();

  return (
    <div className="space-y-4">
      <ImportDropZone
        accept=".csv,text/csv"
        hint={t("settings:tasksImportExport.csv.dropHint")}
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
          {t("settings:tasksImportExport.csv.reading")}
        </p>
      )}

      {error && (
        <Alert variant="error">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {fileName && !isReading && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{fileName}</span>
            {rowCount !== null && (
              <span className="shrink-0 text-muted-foreground">
                {t("settings:tasksImportExport.csv.rowCount", {
                  count: rowCount,
                })}
              </span>
            )}
          </div>

          {delimiter && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={delimiterId}>
                {t("settings:tasksImportExport.csv.delimiter")}
              </Label>
              <Select
                value={DELIMITER_VALUES[delimiter]}
                onValueChange={(value) => {
                  const next = CSV_DELIMITERS.find(
                    (candidate) => DELIMITER_VALUES[candidate] === value,
                  );
                  if (next) onDelimiterChange(next);
                }}
              >
                <SelectTrigger id={delimiterId} className="w-40">
                  <SelectValue>
                    {t(DELIMITER_LABEL_KEYS[delimiter])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CSV_DELIMITERS.map((option) => (
                    <SelectItem key={option} value={DELIMITER_VALUES[option]}>
                      {t(DELIMITER_LABEL_KEYS[option])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={headerId}>
              {t("settings:tasksImportExport.csv.hasHeader")}
            </Label>
            <Switch
              id={headerId}
              checked={hasHeader}
              onCheckedChange={(checked) => onHasHeaderChange(checked)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default CsvUploadStep;
