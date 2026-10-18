import { CircleAlert, FileText, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ExternalImportPreview,
  ExternalImportResult,
  ExternalImportSource,
} from "@/fetchers/external-import/external-import";
import {
  useImportExternalItems,
  usePreviewExternalImport,
} from "@/hooks/mutations/external-import/use-external-import";
import { type CsvImportStep, CsvImportSteps } from "./csv-import-steps";
import { ImportDropZone } from "./import-drop-zone";
import { PLANNED_STATUS, PRIORITY_LABEL_KEYS } from "./jira-mapping-step";
import { JiraResultStep } from "./jira-result-step";

const MIB = 1024 * 1024;

// The server enforces the same limits; checking first saves the upload.
const MAX_FILE_BYTES: Record<ExternalImportSource, number> = {
  trello: 10 * MIB,
  linear: 5 * MIB,
  asana: 5 * MIB,
};

const STEP_LABELS = {
  upload: "settings:tasksImportExport.csv.steps.upload",
  map: "settings:tasksImportExport.jira.steps.map",
  review: "settings:tasksImportExport.jira.steps.import",
} as const;

// Static keys per source, so every string stays a literal i18n key.
const COPY = {
  trello: {
    title: "settings:tasksImportExport.external.title.trello",
    howToTitle: "settings:tasksImportExport.external.howToTitle.trello",
    step1: "settings:tasksImportExport.external.howTo.trello.step1",
    step2: "settings:tasksImportExport.external.howTo.trello.step2",
    limits: "settings:tasksImportExport.external.limits.trello",
    dropHint: "settings:tasksImportExport.external.dropHint.trello",
    wrongType: "settings:tasksImportExport.external.wrongType.trello",
  },
  linear: {
    title: "settings:tasksImportExport.external.title.linear",
    howToTitle: "settings:tasksImportExport.external.howToTitle.linear",
    step1: "settings:tasksImportExport.external.howTo.linear.step1",
    step2: "settings:tasksImportExport.external.howTo.linear.step2",
    limits: "settings:tasksImportExport.external.limits.linear",
    dropHint: "settings:tasksImportExport.external.dropHint.linear",
    wrongType: "settings:tasksImportExport.external.wrongType.linear",
  },
  asana: {
    title: "settings:tasksImportExport.external.title.asana",
    howToTitle: "settings:tasksImportExport.external.howToTitle.asana",
    step1: "settings:tasksImportExport.external.howTo.asana.step1",
    step2: "settings:tasksImportExport.external.howTo.asana.step2",
    limits: "settings:tasksImportExport.external.limits.asana",
    dropHint: "settings:tasksImportExport.external.dropHint.asana",
    wrongType: "settings:tasksImportExport.external.wrongType.asana",
  },
} as const;

type Priority = keyof typeof PRIORITY_LABEL_KEYS;
const PRIORITIES = Object.keys(PRIORITY_LABEL_KEYS) as Priority[];

type Choices = {
  statusMap: Record<string, string>;
  priorityMap: Record<string, Priority>;
  mode: "skip" | "update";
  importComments: boolean;
};

const DEFAULT_CHOICES: Choices = {
  statusMap: {},
  priorityMap: {},
  mode: "skip",
  importComments: true,
};

type ExternalImportDialogProps = {
  source: ExternalImportSource | null;
  onOpenChange: (open: boolean) => void;
  project: {
    id: string;
    columns: ReadonlyArray<{ slug: string; name: string; group?: string }>;
  };
};

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

function fitsSource(source: ExternalImportSource, file: File) {
  const name = file.name.toLowerCase();
  return source === "trello"
    ? name.endsWith(".json") || file.type === "application/json"
    : name.endsWith(".csv") || file.type === "text/csv";
}

/**
 * Imports a Trello board (JSON), or a Linear or Asana CSV export: upload,
 * map statuses and priorities, import, summary.
 */
export function ExternalImportDialog({
  source,
  onOpenChange,
  project,
}: ExternalImportDialogProps) {
  const { t } = useTranslation();
  const open = source !== null;
  const [step, setStep] = useState<CsvImportStep>("upload");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExternalImportPreview | null>(null);
  const [choices, setChoices] = useState<Choices>(DEFAULT_CHOICES);
  const [result, setResult] = useState<ExternalImportResult | null>(null);
  const readToken = useRef(0);
  const previewImport = usePreviewExternalImport();
  const importItems = useImportExternalItems();
  const isImporting = importItems.isPending;
  const modeId = useId();
  const commentsId = useId();

  useEffect(() => {
    if (!source) return;
    readToken.current += 1;
    setStep("upload");
    setFile(null);
    setError(null);
    setPreview(null);
    setChoices(DEFAULT_CHOICES);
    setResult(null);
  }, [source]);

  if (!source) return null;
  const copy = COPY[source];
  const columns = project.columns.filter((column) => column.group !== "triage");
  const backlog = t("settings:tasksImportExport.jira.backlog");
  const columnName = (slug: string) =>
    slug === PLANNED_STATUS
      ? backlog
      : (columns.find((column) => column.slug === slug)?.name ?? backlog);

  const loadFile = async (picked: File) => {
    const token = ++readToken.current;
    setError(null);
    setPreview(null);
    setFile(null);
    if (!fitsSource(source, picked)) {
      setError(t(copy.wrongType));
      return;
    }
    if (picked.size > MAX_FILE_BYTES[source]) {
      setError(
        t("settings:tasksImportExport.csv.errorTooLarge", {
          max: MAX_FILE_BYTES[source] / MIB,
        }),
      );
      return;
    }
    try {
      const text = await picked.text();
      const read = await previewImport.mutateAsync({
        source,
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
    setStep("review");
    try {
      const outcome = await importItems.mutateAsync({
        source,
        projectId: project.id,
        content: file.text,
        options: {
          statusMap: choices.statusMap,
          priorityMap: choices.priorityMap,
          mode: preview.permissions.update ? choices.mode : "skip",
          importComments:
            choices.importComments && preview.permissions.comments,
        },
      });
      setResult(outcome);
      setStep("result");
    } catch (caught) {
      setStep("map");
      setError(messageOf(caught, t("settings:tasksImportExport.importError")));
    }
  };

  const matched = preview?.people.filter((person) => person.member) ?? [];
  const unmatched = preview?.people.filter((person) => !person.member) ?? [];

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
          <DialogTitle>{t(copy.title)}</DialogTitle>
          <CsvImportSteps step={step} labels={STEP_LABELS} />
        </DialogHeader>

        <div className="px-6 py-5">
          {step === "upload" && (
            <div className="space-y-4">
              <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
                <p className="font-medium">{t(copy.howToTitle)}</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>{t(copy.step1)}</li>
                  <li>{t(copy.step2)}</li>
                </ol>
                <p className="text-muted-foreground">{t(copy.limits)}</p>
              </div>

              <ImportDropZone
                accept={
                  source === "trello"
                    ? ".json,application/json"
                    : ".csv,text/csv"
                }
                hint={t(copy.dropHint)}
                buttonLabel={
                  file
                    ? t("settings:tasksImportExport.csv.changeFile")
                    : t("settings:tasksImportExport.csv.selectFile")
                }
                onFile={(picked) => void loadFile(picked)}
                isBusy={previewImport.isPending}
              />

              {previewImport.isPending && (
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

              {file && preview && !previewImport.isPending && (
                <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate font-medium">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {t("settings:tasksImportExport.external.itemCount", {
                        count: preview.itemCount,
                      })}
                    </span>
                  </div>
                  {preview.totals.alreadyImported > 0 && (
                    <p className="text-muted-foreground">
                      {t(
                        "settings:tasksImportExport.external.alreadyImported",
                        { count: preview.totals.alreadyImported },
                      )}
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    {t("settings:tasksImportExport.external.contents", {
                      comments: preview.totals.comments,
                      checklists: preview.totals.checklists,
                      subtasks: preview.totals.subtasks,
                      links: preview.totals.links,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {step === "map" && preview && (
            <div className="max-h-[55vh] space-y-6 overflow-y-auto pr-1">
              {error && (
                <p role="alert" className="text-destructive-foreground text-sm">
                  {error}
                </p>
              )}
              <section className="space-y-2">
                <h3 className="font-medium text-sm">
                  {t("settings:tasksImportExport.jira.statusesTitle")}
                </h3>
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t(
                            "settings:tasksImportExport.external.sourceStatus",
                          )}
                        </TableHead>
                        <TableHead>
                          {t("settings:tasksImportExport.jira.column")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.statuses.map((status) => {
                        const value =
                          choices.statusMap[status.name] ??
                          status.suggestedStatus;
                        return (
                          <TableRow key={status.name}>
                            <TableCell>
                              <span className="font-medium">{status.name}</span>
                              <span className="ml-2 text-muted-foreground text-xs">
                                {t(
                                  "settings:tasksImportExport.external.itemCount",
                                  { count: status.count },
                                )}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={value}
                                onValueChange={(next) => {
                                  if (!next) return;
                                  setChoices({
                                    ...choices,
                                    statusMap: {
                                      ...choices.statusMap,
                                      [status.name]: next,
                                    },
                                  });
                                }}
                              >
                                <SelectTrigger
                                  className="w-48"
                                  aria-label={status.name}
                                >
                                  <SelectValue>{columnName(value)}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {columns.map((column) => (
                                    <SelectItem
                                      key={column.slug}
                                      value={column.slug}
                                    >
                                      {column.name}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value={PLANNED_STATUS}>
                                    {backlog}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </section>

              {preview.priorities.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-medium text-sm">
                    {t("settings:tasksImportExport.jira.prioritiesTitle")}
                  </h3>
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableBody>
                        {preview.priorities.map((priority) => {
                          const value =
                            choices.priorityMap[priority.name] ??
                            priority.suggestedPriority;
                          return (
                            <TableRow key={priority.name}>
                              <TableCell className="font-medium">
                                {priority.name}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={value}
                                  onValueChange={(next) => {
                                    if (!next) return;
                                    setChoices({
                                      ...choices,
                                      priorityMap: {
                                        ...choices.priorityMap,
                                        [priority.name]: next as Priority,
                                      },
                                    });
                                  }}
                                >
                                  <SelectTrigger
                                    className="w-48"
                                    aria-label={priority.name}
                                  >
                                    <SelectValue>
                                      {t(PRIORITY_LABEL_KEYS[value])}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PRIORITIES.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {t(PRIORITY_LABEL_KEYS[option])}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}

              {preview.people.length > 0 && (
                <section className="space-y-2 text-sm">
                  <h3 className="font-medium">
                    {t("settings:tasksImportExport.jira.peopleTitle")}
                  </h3>
                  <p className="text-muted-foreground">
                    {t("settings:tasksImportExport.jira.peopleMatched", {
                      count: matched.length,
                    })}
                  </p>
                  {unmatched.length > 0 && (
                    <p className="text-muted-foreground">
                      {t(
                        "settings:tasksImportExport.external.peopleUnmatched",
                        {
                          count: unmatched.length,
                          names: unmatched
                            .slice(0, 10)
                            .map((person) => person.name)
                            .join(", "),
                        },
                      )}
                    </p>
                  )}
                </section>
              )}

              <section className="space-y-3">
                <h3 className="font-medium text-sm">
                  {t("settings:tasksImportExport.jira.optionsTitle")}
                </h3>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor={modeId}>
                      {t("settings:tasksImportExport.external.mode")}
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      {t("settings:tasksImportExport.external.modeHint")}
                    </p>
                  </div>
                  <Select
                    value={choices.mode}
                    onValueChange={(next) =>
                      setChoices({
                        ...choices,
                        mode: next === "update" ? "update" : "skip",
                      })
                    }
                  >
                    <SelectTrigger id={modeId} className="w-48">
                      <SelectValue>
                        {choices.mode === "update"
                          ? t("settings:tasksImportExport.jira.modeUpdate")
                          : t("settings:tasksImportExport.jira.modeSkip")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">
                        {t("settings:tasksImportExport.jira.modeSkip")}
                      </SelectItem>
                      <SelectItem
                        value="update"
                        disabled={!preview.permissions.update}
                      >
                        {t("settings:tasksImportExport.jira.modeUpdate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {preview.totals.comments > 0 && (
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor={commentsId}>
                        {t("settings:tasksImportExport.jira.importComments")}
                      </Label>
                      {!preview.permissions.comments && (
                        <p className="text-muted-foreground text-xs">
                          {t(
                            "settings:tasksImportExport.jira.commentsNeedPermission",
                          )}
                        </p>
                      )}
                    </div>
                    <Switch
                      id={commentsId}
                      checked={
                        choices.importComments && preview.permissions.comments
                      }
                      disabled={!preview.permissions.comments}
                      onCheckedChange={(next) =>
                        setChoices({ ...choices, importComments: next })
                      }
                    />
                  </div>
                )}
              </section>
            </div>
          )}

          {step === "review" && (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
              {t("settings:tasksImportExport.external.importing", {
                count: preview?.itemCount ?? 0,
              })}
            </p>
          )}
          {step === "result" && result && (
            <JiraResultStep result={result} wording="external" />
          )}
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
                {t("settings:tasksImportExport.external.importAction", {
                  count: preview?.itemCount ?? 0,
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

export default ExternalImportDialog;
