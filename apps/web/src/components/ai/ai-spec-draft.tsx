import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Eye, FilePlus2, Pencil, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { streamSpecDraft } from "@/fetchers/ai/writing";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { taskUrl } from "@/lib/task-key";
import { toast } from "@/lib/toast";
import AiMarkdown from "./ai-markdown";

type AiSpecDraftButtonProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  taskTitle: string;
  /** e.g. "WEB-12"; shown on the task link at the top of the page. */
  taskKey?: string;
};

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The page body: a link back to the task (so the page lists on it), then the spec. */
export function specPageContent(input: {
  url: string;
  taskId: string;
  taskKey?: string;
  markdown: string;
}) {
  const link = `<margaya-issue-link url="${escapeAttribute(input.url)}" issue-key="${escapeAttribute(input.taskKey ?? "")}" task-id="${escapeAttribute(input.taskId)}" />`;
  return `${link}\n\n${input.markdown.trim()}\n`;
}

/**
 * "✦ Draft a spec" on a task: AI drafts a spec page (problem, goals,
 * approach, open questions) that the person reviews and edits before
 * "Create page" adds it to the project, linked to the task. Hidden while AI
 * is off, without page:create, or with Pages off.
 */
export function AiSpecDraftButton(props: AiSpecDraftButtonProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(props.projectId);
  const { isEnabled } = useProjectFeatures({
    projectId: props.projectId,
    workspaceId: props.workspaceId,
  });
  const { canCreatePages } = useWorkspacePermission();
  const [open, setOpen] = useState(false);

  if (!available || !isEnabled("pages") || !canCreatePages()) return null;

  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Sparkles className="size-3.5 text-muted-foreground" />
        {t("ai:writing.spec.button")}
      </Button>
      {open && <AiSpecDraftDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function AiSpecDraftDialog({
  taskId,
  projectId,
  workspaceId,
  taskTitle,
  taskKey,
  onClose,
}: AiSpecDraftButtonProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const titleId = useId();
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const createPage = useCreatePage();
  const [title, setTitle] = useState(() =>
    t("ai:writing.spec.pageTitle", { title: taskTitle }).slice(0, 250),
  );
  const [editing, setEditing] = useState(false);
  // How the draft ended: the server's `done` (complete, or cut off at the
  // token limit) or the person's Stop. Null while drafting, and when the
  // stream closed without `done` (a dropped connection): never ready then.
  const [ending, setEnding] = useState<
    "complete" | "cut_off" | "stopped" | null
  >(null);
  const { status, text, errorKey } = stream;

  const generate = () => {
    setEditing(false);
    setEnding(null);
    void stream.start((handlers) =>
      streamSpecDraft(
        { workspaceId, taskId, ...(locale ? { locale } : {}) },
        {
          ...handlers,
          onDone: (done) =>
            setEnding(done.stop === "max_tokens" ? "cut_off" : "complete"),
        },
      ),
    );
  };

  const stop = () => {
    stream.stop();
    setEnding("stopped");
  };

  // The draft starts when the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    generate();
  }, []);

  const create = () => {
    createPage.mutate(
      {
        projectId,
        title: title.trim() || taskTitle,
        content: specPageContent({
          url: taskUrl({ workspaceId, projectId, taskId }),
          taskId,
          taskKey,
          markdown: text,
        }),
        aiAssist: { feature: "spec_draft" },
      },
      {
        onSuccess: (page) => {
          queryClient.invalidateQueries({
            queryKey: pageQueryKeys.taskReference(taskId),
          });
          toast.success(t("ai:writing.spec.created"), {
            action: {
              label: t("ai:writing.summary.openPage"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, projectId, pageId: page.id },
                }),
            },
          });
          onClose();
        },
        onError: () => toast.error(t("ai:writing.spec.createError")),
      },
    );
  };

  const drafting = status === "streaming";
  const ready = status === "done" && ending !== null && text.trim().length > 0;
  // A draft that ended early: cut off at the limit, or the stream dropped.
  const incomplete =
    status === "done" &&
    text.trim().length > 0 &&
    (ending === "cut_off" || ending === null);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          stream.reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            {t("ai:writing.spec.title")}
          </DialogTitle>
          <DialogDescription>
            {t("ai:writing.spec.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={titleId}>{t("ai:writing.spec.titleLabel")}</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={250}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm">
                {t("ai:writing.spec.bodyLabel")}
              </span>
              {drafting && text && (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Spinner className="size-3" />
                  {t("ai:writing.preview.generating")}
                </span>
              )}
              {ready && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-pressed={editing}
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? <Eye /> : <Pencil />}
                  {editing
                    ? t("ai:writing.spec.preview")
                    : t("ai:writing.spec.edit")}
                </Button>
              )}
            </div>
            {status === "error" ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {t(errorKey ?? "ai:errors.unknown")}
              </p>
            ) : editing ? (
              <Textarea
                aria-label={t("ai:writing.spec.bodyLabel")}
                className="min-h-72 font-mono text-xs"
                value={text}
                onChange={(event) => stream.setText(event.target.value)}
              />
            ) : (
              <div
                aria-live="polite"
                aria-busy={drafting}
                className="max-h-[50vh] min-h-24 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2"
              >
                {text ? (
                  <AiMarkdown text={text} />
                ) : drafting ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                    <Spinner className="size-3.5" />
                    {t("ai:writing.spec.generating")}
                  </span>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("ai:writing.preview.empty")}
                  </p>
                )}
              </div>
            )}
            {incomplete && (
              <p role="status" className="text-warning-foreground text-xs">
                {t("ai:writing.preview.incomplete")}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t("ai:writing.preview.note")}
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          {drafting ? (
            <Button type="button" variant="outline" onClick={stop}>
              {t("ai:writing.preview.stop")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={generate}>
              <RotateCw />
              {t("ai:writing.preview.retry")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stream.reset();
              onClose();
            }}
          >
            {t("ai:writing.preview.discard")}
          </Button>
          <Button
            type="button"
            disabled={!ready || createPage.isPending}
            onClick={create}
          >
            <FilePlus2 />
            {t("ai:writing.spec.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AiSpecDraftButton;
