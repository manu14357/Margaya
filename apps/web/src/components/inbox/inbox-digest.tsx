import { RotateCw, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import AiFeedbackButtons from "@/components/editor/ai/ai-feedback-buttons";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { streamInboxDigest } from "@/fetchers/insight/insight";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";

/**
 * "Summarize unread": a short AI digest of the unread inbox. Reading it
 * marks nothing read. Hidden while AI is off.
 */
export function useInboxDigest(workspaceId: string) {
  const { available } = useAiAvailability(null);
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const run = () =>
    void stream.start((handlers) =>
      streamInboxDigest(
        { workspaceId, ...(locale ? { locale } : {}) },
        handlers,
      ),
    );
  return {
    available,
    workspaceId,
    open: stream.status !== "idle",
    run,
    close: stream.reset,
    stream,
  };
}

export type InboxDigest = ReturnType<typeof useInboxDigest>;

export function InboxDigestButton({
  digest,
  unread,
}: {
  digest: InboxDigest;
  unread: number | undefined;
}) {
  const { t } = useTranslation();
  if (!digest.available) return null;
  const label = t("notifications:inbox.digest.button");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-expanded={digest.open}
          disabled={!unread || digest.stream.status === "streaming"}
          onClick={digest.run}
          className="text-muted-foreground"
        >
          <Sparkles />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function InboxDigestPanel({ digest }: { digest: InboxDigest }) {
  const { t } = useTranslation();
  const { status, text, errorKey } = digest.stream;
  if (!digest.open) return null;
  return (
    <section
      aria-label={t("notifications:inbox.digest.title")}
      className="shrink-0 border-border border-b bg-muted/30 px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-3.5 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("notifications:inbox.digest.title")}
        </h2>
        {status !== "streaming" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("notifications:inbox.digest.regenerate")}
            title={t("notifications:inbox.digest.regenerate")}
            onClick={digest.run}
          >
            <RotateCw />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("notifications:inbox.digest.close")}
          title={t("notifications:inbox.digest.close")}
          onClick={digest.close}
        >
          <X />
        </Button>
      </div>
      <div
        aria-live="polite"
        aria-busy={status === "streaming"}
        className="mt-1 max-h-56 overflow-y-auto"
      >
        {status === "error" ? (
          <p role="alert" className="text-destructive-foreground text-sm">
            {t(errorKey ?? "ai:errors.unknown")}
          </p>
        ) : text ? (
          <AiMarkdown text={text} />
        ) : (
          <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-3.5" />
            {t("notifications:inbox.digest.generating")}
          </span>
        )}
      </div>
      {status === "done" && text.trim() && (
        <div className="mt-1 flex items-center gap-2">
          <AiFeedbackButtons
            workspaceId={digest.workspaceId}
            feature="inbox_digest"
            meta={digest.stream.meta}
            answerKey={digest.stream.meta}
          />
          <span className="ms-auto text-muted-foreground text-xs">
            {t("ai:writing.preview.note")}
          </span>
        </div>
      )}
    </section>
  );
}
