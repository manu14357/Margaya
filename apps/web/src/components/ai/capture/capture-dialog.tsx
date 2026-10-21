import { ArrowLeft, Check, Film, ImagePlus, Sparkles } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CaptureProposal, CaptureResult } from "@/fetchers/ai/capture";
import {
  useAnalyzeCapture,
  useSubmitCaptureDrafts,
} from "@/hooks/mutations/ai/use-ai-capture";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { captureDescription } from "@/lib/ai/capture-description";
import {
  CAPTURE_IMAGE_ACCEPT,
  type CaptureImage,
  CaptureMediaError,
  extractRecordingFrames,
  imageFilesOf,
  MAX_CAPTURE_IMAGES,
  prepareCaptureImage,
  RECORDING_FRAMES,
  releaseCaptureImages,
} from "@/lib/ai/capture-media";
import { aiErrorCode, aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { INTAKE_PRIORITIES } from "@/lib/intake-search";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import type { IntakePriority } from "@/types/intake";
import CaptureThumbnails from "./capture-thumbnails";

type Source = "screenshot" | "recording" | "transcript";

type Draft = {
  key: string;
  include: boolean;
  title: string;
  description: string;
  priority: IntakePriority;
  priorityReason: string | null;
  labels: CaptureProposal["labels"];
  labelIds: string[];
  owner: CaptureProposal["owner"];
  assignOwner: boolean;
};

const MEDIA_ERROR_KEYS = {
  type: "ai:capture.mediaErrors.type",
  tooLarge: "ai:capture.mediaErrors.tooLarge",
  unreadable: "ai:capture.mediaErrors.unreadable",
} as const;

function mediaErrorKey(error: unknown) {
  return error instanceof CaptureMediaError
    ? MEDIA_ERROR_KEYS[error.code]
    : MEDIA_ERROR_KEYS.unreadable;
}

type CaptureDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Capture": screenshots, a screen recording (key frames taken in the
 * browser) or a meeting transcript become proposed intake requests. People
 * edit and pick the proposals; "Create" submits them through the intake
 * route and attaches the images. Mount only when AI is available.
 */
export default function CaptureDialog({
  projectId,
  open,
  onOpenChange,
}: CaptureDialogProps) {
  const { t } = useTranslation();
  const locale = useAiLocale();
  const permissions = useWorkspacePermission();
  const analyze = useAnalyzeCapture();
  const submit = useSubmitCaptureDrafts();
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const notesId = useId();
  const transcriptId = useId();
  const [source, setSource] = useState<Source>("screenshot");
  const [images, setImages] = useState<CaptureImage[]>([]);
  const [frames, setFrames] = useState<CaptureImage[]>([]);
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [analyzedSource, setAnalyzedSource] = useState<Source>("screenshot");
  const media = useRef<CaptureImage[]>([]);
  media.current = [...images, ...frames];

  const canAttach = permissions.canUpdateTasks();
  const canLabel = permissions.canUpdateLabels();
  const canAssign = permissions.canAssignTasks();

  const reset = () => {
    releaseCaptureImages(media.current);
    setImages([]);
    setFrames([]);
    setNotes("");
    setTranscript("");
    setDrafts(null);
    setSource("screenshot");
    analyze.reset();
  };

  // Object URLs of thumbnails are released when the dialog goes away.
  useEffect(() => () => releaseCaptureImages(media.current), []);

  const close = () => {
    if (submit.isPending) return;
    reset();
    onOpenChange(false);
  };

  const addImages = async (files: File[]) => {
    if (files.length === 0) return;
    const room = MAX_CAPTURE_IMAGES - images.length;
    if (files.length > room) {
      toast.warning(t("ai:capture.tooMany", { count: MAX_CAPTURE_IMAGES }));
    }
    setBusy(true);
    const added: CaptureImage[] = [];
    for (const [index, file] of files.slice(0, Math.max(0, room)).entries()) {
      try {
        added.push(await prepareCaptureImage(file, images.length + index));
      } catch (error) {
        toast.error(t(mediaErrorKey(error)));
      }
    }
    setImages((current) => [...current, ...added]);
    setBusy(false);
  };

  const chooseRecording = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const next = await extractRecordingFrames(file);
      releaseCaptureImages(frames);
      setFrames(next);
    } catch (error) {
      toast.error(t(mediaErrorKey(error)));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = (id: string) => {
    const remove = (list: CaptureImage[]) => {
      const gone = list.filter((image) => image.id === id);
      releaseCaptureImages(gone);
      return list.filter((image) => image.id !== id);
    };
    setImages(remove);
    setFrames(remove);
  };

  const onPaste = (event: ClipboardEvent) => {
    if (drafts) return;
    const files = imageFilesOf(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    setSource("screenshot");
    void addImages(files);
  };

  const onDrop = (event: DragEvent) => {
    const files = imageFilesOf(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    void addImages(files);
  };

  const evidence = source === "recording" ? frames : images;
  const text = (source === "transcript" ? transcript : notes).trim();
  const canAnalyze =
    !busy &&
    !analyze.isPending &&
    (source === "transcript"
      ? text.length > 0
      : evidence.length > 0 || (source === "screenshot" && text.length > 0));

  const run = () => {
    if (!canAnalyze) return;
    const used = source === "transcript" ? [] : evidence;
    analyze.mutate(
      {
        projectId,
        body: {
          source,
          images: used.map((image) => ({
            mediaType: image.mediaType,
            data: image.data,
          })),
          ...(text ? { text } : {}),
          ...(locale ? { locale } : {}),
        },
      },
      {
        onSuccess: (result: CaptureResult) => {
          setAnalyzedSource(source);
          setDrafts(
            result.items.map((item, index) => ({
              key: `${index}-${item.title}`,
              include: true,
              title: item.title,
              description: captureDescription(item, t),
              priority: item.priority,
              priorityReason: item.priorityReason,
              labels: item.labels,
              labelIds: canLabel ? item.labels.map((l) => l.labelId) : [],
              owner: item.owner,
              assignOwner: Boolean(item.owner) && canAssign,
            })),
          );
        },
      },
    );
  };

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current
        ? current.map((draft) =>
            draft.key === key ? { ...draft, ...patch } : draft,
          )
        : current,
    );

  const chosen = (drafts ?? []).filter(
    (draft) => draft.include && draft.title.trim(),
  );
  const attachments =
    analyzedSource === "transcript"
      ? []
      : analyzedSource === "recording"
        ? frames
        : images;

  const create = () => {
    if (chosen.length === 0) return;
    submit.mutate(
      {
        projectId,
        can: { label: canLabel, assign: canAssign, attach: canAttach },
        drafts: chosen.map((draft, index) => ({
          title: draft.title.trim().slice(0, 500),
          description: draft.description,
          priority: draft.priority,
          labelIds: draft.labelIds,
          ownerId: draft.assignOwner ? (draft.owner?.userId ?? null) : null,
          // The evidence belongs to the first request (a capture of
          // images yields one).
          files: index === 0 ? attachments.map((image) => image.file) : [],
        })),
      },
      {
        onSuccess: (result) => {
          toast.success(
            t("ai:capture.created", { count: result.created.length }),
          );
          if (result.extrasFailed > 0) {
            toast.warning(t("ai:capture.extrasFailed"));
          }
          reset();
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(error.message || t("ai:capture.createError")),
      },
    );
  };

  const analyzeError = analyze.error
    ? aiErrorCode(analyze.error)
      ? t(aiErrorKey(analyze.error))
      : analyze.error.message || t("ai:errors.unknown")
    : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-2xl" onPaste={onPaste}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {drafts ? t("ai:capture.reviewTitle") : t("ai:capture.title")}
          </DialogTitle>
          <DialogDescription>
            {drafts
              ? t("ai:capture.reviewDescription")
              : t("ai:capture.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {drafts ? (
            <div aria-live="polite" className="space-y-3">
              {drafts.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("ai:capture.empty")}
                </p>
              ) : (
                drafts.map((draft) => (
                  <DraftEditor
                    key={draft.key}
                    draft={draft}
                    canLabel={canLabel}
                    canAssign={canAssign}
                    onChange={(patch) => update(draft.key, patch)}
                  />
                ))
              )}
              {attachments.length > 0 && chosen.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  {canAttach
                    ? t("ai:capture.attachNote", { count: attachments.length })
                    : t("ai:capture.attachNotAllowed")}
                </p>
              )}
            </div>
          ) : (
            <Tabs
              value={source}
              onValueChange={(value) => setSource(value as Source)}
            >
              <TabsList>
                <TabsTab value="screenshot">
                  {t("ai:capture.tabs.screenshot")}
                </TabsTab>
                <TabsTab value="recording">
                  {t("ai:capture.tabs.recording")}
                </TabsTab>
                <TabsTab value="transcript">
                  {t("ai:capture.tabs.transcript")}
                </TabsTab>
              </TabsList>
              <TabsPanel value="screenshot" className="space-y-3 pt-3">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onDrop}
                  className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed px-4 py-5 text-center text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ImagePlus
                    aria-hidden="true"
                    className="size-5 text-muted-foreground"
                  />
                  <span className="font-medium">
                    {t("ai:capture.dropzone")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("ai:capture.dropzoneHint", {
                      count: MAX_CAPTURE_IMAGES,
                    })}
                  </span>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={CAPTURE_IMAGE_ACCEPT}
                  multiple
                  hidden
                  onChange={(event) => {
                    void addImages(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <CaptureThumbnails
                  images={images}
                  onRemove={removeImage}
                  removeLabel={(name) => t("ai:capture.remove", { name })}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={notesId}>{t("ai:capture.notes")}</Label>
                  <Textarea
                    id={notesId}
                    value={notes}
                    maxLength={60_000}
                    placeholder={t("ai:capture.notesPlaceholder")}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </TabsPanel>
              <TabsPanel value="recording" className="space-y-3 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => videoInput.current?.click()}
                >
                  <Film />
                  {t("ai:capture.chooseRecording")}
                </Button>
                <input
                  ref={videoInput}
                  type="file"
                  accept="video/*"
                  hidden
                  onChange={(event) => {
                    void chooseRecording(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai:capture.recordingHint", { count: RECORDING_FRAMES })}
                </p>
                <CaptureThumbnails
                  images={frames}
                  onRemove={removeImage}
                  removeLabel={(name) => t("ai:capture.remove", { name })}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={`${notesId}-recording`}>
                    {t("ai:capture.notes")}
                  </Label>
                  <Textarea
                    id={`${notesId}-recording`}
                    value={notes}
                    maxLength={60_000}
                    placeholder={t("ai:capture.notesPlaceholder")}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </TabsPanel>
              <TabsPanel value="transcript" className="space-y-1.5 pt-3">
                <Label htmlFor={transcriptId}>
                  {t("ai:capture.transcript")}
                </Label>
                <Textarea
                  id={transcriptId}
                  className="min-h-48"
                  value={transcript}
                  maxLength={60_000}
                  placeholder={t("ai:capture.transcriptPlaceholder")}
                  onChange={(event) => setTranscript(event.target.value)}
                />
              </TabsPanel>
            </Tabs>
          )}
          {(busy || analyze.isPending) && (
            <p
              aria-live="polite"
              className="inline-flex items-center gap-2 text-muted-foreground text-sm"
            >
              <Spinner className="size-3.5" />
              {analyze.isPending
                ? t("ai:capture.analyzing")
                : t("ai:capture.preparing")}
            </p>
          )}
          {analyzeError && !drafts && (
            <p role="alert" className="text-destructive-foreground text-sm">
              {analyzeError}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          {drafts ? (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={submit.isPending}
                onClick={() => setDrafts(null)}
              >
                <ArrowLeft />
                {t("ai:capture.back")}
              </Button>
              <Button
                type="button"
                disabled={chosen.length === 0 || submit.isPending}
                onClick={create}
              >
                {submit.isPending ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <Check />
                )}
                {t("ai:capture.create", { count: chosen.length })}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                {t("common:actions.cancel")}
              </Button>
              <Button type="button" disabled={!canAnalyze} onClick={run}>
                <Sparkles />
                {t("ai:capture.analyze")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftEditor({
  draft,
  canLabel,
  canAssign,
  onChange,
}: {
  draft: Draft;
  canLabel: boolean;
  canAssign: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "space-y-2.5 rounded-md border bg-muted/30 p-3",
        !draft.include && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-include`}
          checked={draft.include}
          onCheckedChange={(checked) => onChange({ include: checked === true })}
        />
        <Label htmlFor={`${id}-include`} className="text-xs">
          {t("ai:capture.include")}
        </Label>
      </div>
      <div className="space-y-1">
        <Label id={`${id}-title`} htmlFor={`${id}-title-input`}>
          {t("ai:capture.titleLabel")}
        </Label>
        <Input
          id={`${id}-title-input`}
          value={draft.title}
          maxLength={500}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-description`}>
          {t("ai:capture.descriptionLabel")}
        </Label>
        <Textarea
          id={`${id}-description`}
          className="min-h-28 text-sm"
          value={draft.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("ai:capture.priorityLabel")}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/50"
            >
              {getPriorityIcon(draft.priority)}
              {getPriorityLabel(draft.priority)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            {INTAKE_PRIORITIES.map((option) => (
              <button
                key={option}
                type="button"
                className="flex h-8 w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
                onClick={() => onChange({ priority: option })}
              >
                {getPriorityIcon(option)}
                {getPriorityLabel(option)}
                {draft.priority === option && (
                  <Check className="ml-auto size-4" />
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {draft.priorityReason && (
          <span className="text-muted-foreground text-xs">
            {draft.priorityReason}
          </span>
        )}
      </div>
      {canLabel && draft.labels.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-muted-foreground text-xs">
            {t("ai:capture.labelsLabel")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {draft.labels.map((label) => {
              const on = draft.labelIds.includes(label.labelId);
              return (
                <button
                  key={label.labelId}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      labelIds: on
                        ? draft.labelIds.filter((id) => id !== label.labelId)
                        : [...draft.labelIds, label.labelId],
                    })
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent/50",
                    !on && "text-muted-foreground line-through",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: resolveLabelColor(label.color) }}
                  />
                  {label.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {canAssign && draft.owner && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-owner`}
            checked={draft.assignOwner}
            onCheckedChange={(checked) =>
              onChange({ assignOwner: checked === true })
            }
          />
          <Label htmlFor={`${id}-owner`} className="text-xs">
            {t("ai:capture.assignTo", { name: draft.owner.name })}
          </Label>
          {draft.owner.reason && (
            <span className="text-muted-foreground text-xs">
              {draft.owner.reason}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
