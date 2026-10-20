import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Copy,
  FilePlus2,
  MessageSquarePlus,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import AiFeedbackButtons from "@/components/editor/ai/ai-feedback-buttons";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type SummaryKind, streamSummary } from "@/fetchers/ai/writing";
import useCreateComment from "@/hooks/mutations/comment/use-create-comment";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import AiMarkdown from "./ai-markdown";

type AiSummaryButtonProps = {
  kind: SummaryKind;
  /** The cycle, project or page. */
  id: string;
  /** Its project: AI availability, and where "Save as page" saves. */
  projectId: string;
  workspaceId: string;
  /** Its name, for the saved page's title. */
  name: string;
  className?: string;
};

const LABEL_KEY: Record<SummaryKind, string> = {
  cycle: "ai:writing.summary.cycle",
  project: "ai:writing.summary.project",
  page: "ai:writing.summary.page",
  task: "ai:writing.summary.task",
};

/**
 * "✦ Summarize" for a cycle, project or page. The summary streams into a
 * dismissible card with Copy and Save as page. Hidden while AI is off.
 */
export function AiSummaryButton({
  kind,
  id,
  projectId,
  workspaceId,
  name,
  className,
}: AiSummaryButtonProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId);
  const [open, setOpen] = useState(false);

  if (!available) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className={cn("gap-1", className)}
        aria-label={t(LABEL_KEY[kind])}
        title={t(LABEL_KEY[kind])}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles className="size-3 text-muted-foreground" />
        <span className="hidden md:inline">
          {t("ai:writing.summary.button")}
        </span>
      </Button>
      {open && (
        <AiSummaryPanel
          kind={kind}
          id={id}
          projectId={projectId}
          workspaceId={workspaceId}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The summary card on its own, streaming from the moment it opens. Menus
 * that offer "Summarize" (the cycle header's AI menu) render it directly.
 */
export function AiSummaryPanel({
  kind,
  id,
  projectId,
  workspaceId,
  name,
  onClose,
}: Omit<AiSummaryButtonProps, "className"> & { onClose: () => void }) {
  const stream = useAiTextStream();
  const locale = useAiLocale();
  const { start } = stream;

  const run = useCallback(() => {
    void start((handlers) =>
      streamSummary(
        { workspaceId, kind, id, ...(locale ? { locale } : {}) },
        handlers,
      ),
    );
  }, [start, workspaceId, kind, id, locale]);

  // One summary per opening; Try again runs another.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    runRef.current();
  }, []);

  return (
    <AiSummaryCard
      kind={kind}
      id={id}
      projectId={projectId}
      workspaceId={workspaceId}
      name={name}
      stream={stream}
      onRegenerate={run}
      onClose={() => {
        stream.reset();
        onClose();
      }}
    />
  );
}

function AiSummaryCard({
  kind,
  id,
  projectId,
  workspaceId,
  name,
  stream,
  onRegenerate,
  onClose,
}: {
  kind: SummaryKind;
  id: string;
  projectId: string;
  workspaceId: string;
  name: string;
  stream: ReturnType<typeof useAiTextStream>;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { canCreatePages, canUpdateTasks } = useWorkspacePermission();
  const createPage = useCreatePage();
  const createComment = useCreateComment();
  const queryClient = useQueryClient();
  const { status, text, errorKey } = stream;
  const isTask = kind === "task";
  const canSave = !isTask && isEnabled("pages") && canCreatePages();
  const canComment = isTask && canUpdateTasks();
  const finished = status === "done" && text.trim().length > 0;

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error(t("ai:writing.summary.copyError"));
    }
  };

  const save = () => {
    createPage.mutate(
      {
        projectId,
        title: t("ai:writing.summary.pageTitle", { name: name.slice(0, 200) }),
        content: text,
      },
      {
        onSuccess: (page) => {
          toast.success(t("ai:writing.summary.saved"), {
            action: {
              label: t("ai:writing.summary.openPage"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, projectId, pageId: page.id },
                }),
            },
          });
        },
        onError: () => toast.error(t("ai:writing.summary.saveError")),
      },
    );
  };

  // A task summary saved as a comment, which the activity feed shows.
  const saveAsComment = () => {
    createComment.mutate(
      { taskId: id, comment: text },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["activities", id] });
          toast.success(t("ai:writing.summary.commentSaved"));
          onClose();
        },
        onError: () => toast.error(t("ai:writing.summary.commentError")),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-label={t(LABEL_KEY[kind])}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-x-4 top-16 z-40 flex max-h-[70vh] flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none sm:inset-x-auto sm:right-4 sm:w-[28rem]"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("ai:writing.summary.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("ai:writing.summary.dismiss")}
          title={t("ai:writing.summary.dismiss")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div
        className="min-h-16 overflow-y-auto px-3 py-2"
        aria-live="polite"
        aria-busy={status === "streaming"}
      >
        {status === "error" ? (
          <p role="alert" className="text-destructive-foreground text-sm">
            {t(errorKey ?? "ai:errors.unknown")}
          </p>
        ) : text ? (
          <AiMarkdown text={text} />
        ) : status === "streaming" ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-3.5" />
            {t("ai:writing.summary.generating")}
          </span>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("ai:writing.preview.empty")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {status === "streaming" ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={stream.stop}
          >
            {t("ai:writing.preview.stop")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!finished}
              onClick={() => void copy()}
            >
              {copied ? <Check /> : <Copy />}
              {copied
                ? t("ai:writing.summary.copied")
                : t("ai:writing.summary.copy")}
            </Button>
            {canSave && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!finished || createPage.isPending}
                onClick={save}
              >
                <FilePlus2 />
                {t("ai:writing.summary.saveAsPage")}
              </Button>
            )}
            {canComment && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={!finished || createComment.isPending}
                onClick={saveAsComment}
              >
                <MessageSquarePlus />
                {t("ai:writing.summary.saveAsComment")}
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={onRegenerate}
            >
              <RotateCw />
              {t("ai:writing.preview.retry")}
            </Button>
            {finished && (
              <AiFeedbackButtons
                workspaceId={workspaceId}
                feature="summarize"
                meta={stream.meta}
                answerKey={stream.meta}
              />
            )}
          </>
        )}
        <span className="ms-auto text-muted-foreground text-xs">
          {t("ai:writing.preview.note")}
        </span>
      </div>
    </div>,
    document.body,
  );
}

export default AiSummaryButton;
