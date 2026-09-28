import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  JiraImportPreview,
  JiraImportResult,
} from "@/fetchers/jira-import/jira-import";
import {
  useImportJiraIssues,
  usePreviewJiraImport,
} from "@/hooks/mutations/jira-import/use-jira-import";
import { isCsvFile } from "./csv-import-dialog";
import { type CsvImportStep, CsvImportSteps } from "./csv-import-steps";
import { type JiraChoices, JiraMappingStep } from "./jira-mapping-step";
import { JiraResultStep } from "./jira-result-step";
import { JiraUploadStep } from "./jira-upload-step";

// The server enforces the same limit; checking first saves the upload.
export const MAX_JIRA_FILE_BYTES = 5 * 1024 * 1024;

const STEP_LABELS = {
  upload: "settings:tasksImportExport.csv.steps.upload",
  map: "settings:tasksImportExport.jira.steps.map",
  review: "settings:tasksImportExport.jira.steps.import",
} as const;

const DEFAULT_CHOICES: JiraChoices = {
  statusMap: {},
  priorityMap: {},
  options: {
    mode: "skip",
    issueTypeAsLabel: true,
    importComments: true,
    sprintsAsCycles: false,
    componentsAsModules: false,
  },
};

type JiraImportProject = {
  id: string;
  columns: ReadonlyArray<{ slug: string; name: string; group?: string }>;
};

type JiraImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: JiraImportProject;
};

/** Error text from the API: its JSON message, else the raw text. */
function messageOf(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Plain text.
  }
  return error.message;
}

/** Import issues from Jira's CSV export: upload, map, import, summary. */
export function JiraImportDialog({
  open,
  onOpenChange,
  project,
}: JiraImportDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CsvImportStep>("upload");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<JiraImportPreview | null>(null);
  const [choices, setChoices] = useState<JiraChoices>(DEFAULT_CHOICES);
  const [result, setResult] = useState<JiraImportResult | null>(null);
  const readToken = useRef(0);
  const previewImport = usePreviewJiraImport();
  const importIssues = useImportJiraIssues();
  const isImporting = importIssues.isPending;

  useEffect(() => {
    if (!open) return;
    readToken.current += 1;
    setStep("upload");
    setFile(null);
    setError(null);
    setPreview(null);
    setChoices(DEFAULT_CHOICES);
    setResult(null);
  }, [open]);

  const loadFile = async (picked: File) => {
    const token = ++readToken.current;
    setError(null);
    setPreview(null);
    setFile(null);
    if (!isCsvFile(picked)) {
      setError(t("settings:tasksImportExport.csv.errorNotCsv"));
      return;
    }
    if (picked.size > MAX_JIRA_FILE_BYTES) {
      setError(
        t("settings:tasksImportExport.csv.errorTooLarge", {
          max: MAX_JIRA_FILE_BYTES / (1024 * 1024),
        }),
      );
      return;
    }
    try {
      const text = await picked.text();
      const read = await previewImport.mutateAsync({
        projectId: project.id,
        content: text,
      });
      if (token !== readToken.current) return;
      setFile({ name: picked.name, text });
      setPreview(read);
      setChoices(DEFAULT_CHOICES);
    } catch (caught) {
      if (token !== readToken.current) return;
      setError(
        messageOf(caught, t("settings:tasksImportExport.jira.previewError")),
      );
    }
  };

  const handleImport = async () => {
    if (!file || !preview || isImporting) return;
    const { features, permissions } = preview;
    const { options } = choices;
    setStep("review");
    try {
      const outcome = await importIssues.mutateAsync({
        projectId: project.id,
        content: file.text,
        options: {
          statusMap: choices.statusMap,
          priorityMap: choices.priorityMap,
          mode: permissions.update ? options.mode : "skip",
          issueTypeAsLabel: options.issueTypeAsLabel,
          importComments: options.importComments && permissions.comments,
          sprintsAsCycles:
            options.sprintsAsCycles && features.cycles && permissions.cycles,
          componentsAsModules:
            options.componentsAsModules &&
            features.modules &&
            permissions.modules,
        },
      });
      setResult(outcome);
      setStep("result");
    } catch (caught) {
      setStep("map");
      setError(messageOf(caught, t("settings:tasksImportExport.importError")));
    }
  };

  const columns = project.columns.filter((column) => column.group !== "triage");

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
          <DialogTitle>
            {t("settings:tasksImportExport.jira.title")}
          </DialogTitle>
          <CsvImportSteps step={step} labels={STEP_LABELS} />
        </DialogHeader>

        <div className="px-6 py-5">
          {step === "upload" && (
            <JiraUploadStep
              fileName={file?.name ?? null}
              isReading={previewImport.isPending}
              error={error}
              preview={preview}
              onFile={(picked) => void loadFile(picked)}
            />
          )}
          {step === "map" && preview && (
            <div className="space-y-4">
              {error && (
                <p role="alert" className="text-destructive-foreground text-sm">
                  {error}
                </p>
              )}
              <JiraMappingStep
                preview={preview}
                columns={columns}
                choices={choices}
                onChange={setChoices}
              />
            </div>
          )}
          {step === "review" && (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("settings:tasksImportExport.jira.importing", {
                count: preview?.issueCount ?? 0,
              })}
            </p>
          )}
          {step === "result" && result && <JiraResultStep result={result} />}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step === "upload" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common:actions.cancel")}
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  setStep("map");
                }}
                disabled={!preview || previewImport.isPending}
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
              <Button onClick={() => void handleImport()}>
                {t("settings:tasksImportExport.jira.importAction", {
                  count: preview?.issueCount ?? 0,
                })}
              </Button>
            </>
          )}
          {step === "review" && (
            <Button disabled>
              <Loader2 className="animate-spin" />
              {t("settings:tasksImportExport.csv.import")}
            </Button>
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

export default JiraImportDialog;
