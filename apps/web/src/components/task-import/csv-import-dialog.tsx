import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import useImportTasks from "@/hooks/mutations/task/use-import-tasks";
import useCsvImportContext from "@/hooks/queries/task-import/use-csv-import-context";
import { formatNumber } from "@/lib/format";
import {
  type BatchImportResult,
  CSV_IMPORT_BATCH_SIZE,
} from "@/lib/task-import/batch";
import type { ImportDateFormat } from "@/lib/task-import/csv-dates";
import {
  autoMap,
  type ColumnMapping,
  emptyMapping,
  IMPORT_FIELDS,
  resolveRows,
} from "@/lib/task-import/csv-mapping";
import {
  type CsvDelimiter,
  type CsvReadError,
  isBlankRecord,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  readCsv,
} from "@/lib/task-import/csv-parse";
import { toast } from "@/lib/toast";
import { type CsvImportStep, CsvImportSteps } from "./csv-import-steps";
import { CsvMappingStep } from "./csv-mapping-step";
import { CsvResultStep } from "./csv-result-step";
import { CsvReviewStep } from "./csv-review-step";
import { CsvUploadStep } from "./csv-upload-step";

const PREVIEW_ROWS = 5;

type CsvImportProject = {
  id: string;
  workspaceId: string;
  columns: ReadonlyArray<{ slug: string; name: string; group?: string }>;
};

type CsvImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: CsvImportProject;
  /** A file picked before the dialog opened (the import menu's picker). */
  initialFile?: File | null;
};

type LoadedFile = { name: string; text: string };

export function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Import tasks from a CSV file: upload, map columns, review, result. */
export function CsvImportDialog({
  open,
  onOpenChange,
  project,
  initialFile,
}: CsvImportDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CsvImportStep>("upload");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [fileError, setFileError] = useState<CsvReadError | null>(null);
  const [delimiter, setDelimiter] = useState<CsvDelimiter | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  const mappingSource = useRef<string | null>(null);
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("auto");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [outcome, setOutcome] = useState<{
    result: BatchImportResult;
    rowNumbers: number[];
  } | null>(null);
  const readToken = useRef(0);

  const importContext = useCsvImportContext(project, { enabled: open });
  const importTasks = useImportTasks();
  const isImporting = progress !== null && outcome === null;

  const loadFile = async (picked: File) => {
    const token = ++readToken.current;
    setFileError(null);
    if (!isCsvFile(picked)) {
      setFileError("notCsv");
      return;
    }
    if (picked.size > MAX_CSV_BYTES) {
      setFileError("tooLarge");
      return;
    }
    setIsReading(true);
    try {
      const text = await readFileText(picked);
      if (token !== readToken.current) return;
      setFile({ name: picked.name, text });
      setDelimiter(null);
    } catch {
      if (token === readToken.current) setFileError("notCsv");
    } finally {
      if (token === readToken.current) setIsReading(false);
    }
  };

  // Each opening starts over, with the file picked outside when there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens
  useEffect(() => {
    if (!open) return;
    readToken.current += 1;
    setStep("upload");
    setFile(null);
    setIsReading(false);
    setFileError(null);
    setDelimiter(null);
    setHasHeader(true);
    setMapping(emptyMapping());
    mappingSource.current = null;
    setDateFormat("auto");
    setProgress(null);
    setOutcome(null);
    if (initialFile) void loadFile(initialFile);
  }, [open, initialFile]);

  const parsed = useMemo(
    () =>
      file
        ? readCsv(file.text, { delimiter: delimiter ?? undefined, hasHeader })
        : null,
    [file, delimiter, hasHeader],
  );
  const table = parsed?.ok ? parsed.table : null;
  const readError = fileError ?? (parsed && !parsed.ok ? parsed.error : null);

  const errorMessage = (() => {
    switch (readError) {
      case "empty":
        return t("settings:tasksImportExport.csv.errorEmpty");
      case "tooManyRows":
        return t("settings:tasksImportExport.csv.errorTooManyRows", {
          max: formatNumber(MAX_CSV_ROWS),
        });
      case "tooLarge":
        return t("settings:tasksImportExport.csv.errorTooLarge", {
          max: MAX_CSV_BYTES / (1024 * 1024),
        });
      case "notCsv":
        return t("settings:tasksImportExport.csv.errorNotCsv");
      default:
        return null;
    }
  })();

  const columnNames = useMemo(
    () =>
      (table?.headers ?? []).map(
        (header, index) =>
          header ||
          t("settings:tasksImportExport.csv.columnFallback", {
            index: index + 1,
          }),
      ),
    [table, t],
  );
  const firstDataRow = useMemo(
    () => table?.rows.find((row) => !isBlankRecord(row)) ?? [],
    [table],
  );

  const resolved = useMemo(
    () =>
      table && step === "review"
        ? resolveRows(
            table.rows,
            mapping,
            { ...importContext.context, dateFormat },
            table.firstRowNumber,
          )
        : null,
    [table, step, mapping, importContext.context, dateFormat],
  );

  const previewFields = IMPORT_FIELDS.filter(
    (field) => importContext.fields.includes(field) && mapping[field] !== null,
  );
  const previewRows = (resolved?.tasks ?? [])
    .slice(0, PREVIEW_ROWS)
    .map(({ row }) => {
      const cells = table?.rows[row - (table?.firstRowNumber ?? 0)] ?? [];
      return {
        row,
        values: previewFields.map((field) => {
          const column = mapping[field];
          return column === null ? "" : (cells[column] ?? "").trim();
        }),
      };
    });

  const goToMapping = () => {
    if (!table || !file) return;
    // Keep manual choices unless the file or its layout changed.
    const source = `${file.name}|${file.text.length}|${parsed?.ok ? parsed.delimiter : ""}|${hasHeader}`;
    if (mappingSource.current !== source) {
      mappingSource.current = source;
      setMapping(
        hasHeader
          ? autoMap(table.headers, importContext.fields)
          : emptyMapping(),
      );
    }
    setStep("map");
  };

  const handleImport = async () => {
    if (!resolved || resolved.tasks.length === 0 || isImporting) return;
    const tasks = resolved.tasks.map((entry) => entry.task);
    setProgress({ done: 0, total: tasks.length });
    try {
      const result = await importTasks.mutateAsync({
        projectId: project.id,
        tasks,
        batchSize: CSV_IMPORT_BATCH_SIZE,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setOutcome({
        result,
        rowNumbers: resolved.tasks.map((entry) => entry.row),
      });
      setStep("result");
    } catch (error) {
      setProgress(null);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:tasksImportExport.importError"),
      );
    }
  };

  const mapped = (field: (typeof IMPORT_FIELDS)[number]) =>
    importContext.fields.includes(field) && mapping[field] !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isImporting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl p-0 gap-0">
        <DialogHeader className="space-y-3 border-b border-border px-6 py-5">
          <DialogTitle>{t("settings:tasksImportExport.csv.title")}</DialogTitle>
          <CsvImportSteps step={step} />
        </DialogHeader>

        <div className="px-6 py-5">
          {step === "upload" && (
            <CsvUploadStep
              fileName={file?.name ?? null}
              rowCount={
                table
                  ? table.rows.filter((row) => !isBlankRecord(row)).length
                  : null
              }
              isReading={isReading}
              error={errorMessage}
              delimiter={parsed?.ok ? parsed.delimiter : delimiter}
              onDelimiterChange={setDelimiter}
              hasHeader={hasHeader}
              onHasHeaderChange={setHasHeader}
              onFile={(picked) => void loadFile(picked)}
            />
          )}
          {step === "map" && (
            <CsvMappingStep
              fields={importContext.fields}
              columns={columnNames}
              mapping={mapping}
              onChange={(field, column) =>
                setMapping((current) => ({ ...current, [field]: column }))
              }
              sampleRow={firstDataRow}
            />
          )}
          {step === "review" && resolved && (
            <CsvReviewStep
              result={resolved}
              previewFields={previewFields}
              previewRows={previewRows}
              showDateFormat={mapped("startDate") || mapped("dueDate")}
              dateFormat={dateFormat}
              onDateFormatChange={setDateFormat}
              progress={progress}
            />
          )}
          {step === "result" && outcome && (
            <CsvResultStep
              result={outcome.result}
              rowNumbers={outcome.rowNumbers}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common:actions.cancel")}
              </Button>
              <Button
                onClick={goToMapping}
                disabled={!table || isReading || importContext.isLoading}
              >
                {t("settings:tasksImportExport.csv.next")}
              </Button>
            </>
          )}
          {step === "map" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                {t("settings:tasksImportExport.csv.back")}
              </Button>
              <Button
                onClick={() => setStep("review")}
                disabled={mapping.title === null}
              >
                {t("settings:tasksImportExport.csv.next")}
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("map")}
                disabled={isImporting}
              >
                {t("settings:tasksImportExport.csv.back")}
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={
                  isImporting || !resolved || resolved.tasks.length === 0
                }
              >
                {t("settings:tasksImportExport.csv.import")}
              </Button>
            </>
          )}
          {step === "result" && (
            <Button onClick={() => onOpenChange(false)}>
              {t("settings:tasksImportExport.csv.result.done")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CsvImportDialog;
