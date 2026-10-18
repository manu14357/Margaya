import { useMutation } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { Check, RotateCw, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { suggestPageTitle } from "@/fetchers/ai/writing";
import { useUpdatePage } from "@/hooks/mutations/page/use-update-page";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useAiLocale } from "./use-editor-ai";

const MAX_PAGE_CHARS = 60_000;

/**
 * "✦ Suggest title": one title from the page's live content, applied with
 * one click through the ordinary page update. Hidden while AI is off or
 * the page is read-only.
 */
export default function AiPageTitle({
  pageId,
  projectId,
  workspaceId,
  editor,
  canEdit,
  className,
}: {
  pageId: string;
  projectId: string;
  workspaceId: string;
  editor: Editor | null;
  canEdit: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId || null);
  const locale = useAiLocale();
  const updatePage = useUpdatePage();
  const suggest = useMutation({ mutationFn: suggestPageTitle });

  if (!available || !canEdit) return null;

  const run = () => {
    const text = editor?.getMarkdown().trim().slice(0, MAX_PAGE_CHARS) ?? "";
    suggest.mutate({
      workspaceId,
      pageId,
      ...(text ? { text } : {}),
      ...(locale ? { locale } : {}),
    });
  };

  const apply = (title: string) => {
    updatePage.mutate(
      { pageId, projectId, json: { title } },
      {
        onSuccess: () => suggest.reset(),
        onError: () => toast.error(t("pages:toasts.titleError")),
      },
    );
  };

  return (
    <div
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-2 text-xs print:hidden",
        className,
      )}
      aria-live="polite"
    >
      {suggest.isIdle && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="gap-1 text-muted-foreground"
          onClick={run}
        >
          <Sparkles aria-hidden className="size-3" />
          {t("ai:writing.title.suggest")}
        </Button>
      )}
      {suggest.isPending && (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3" />
          {t("ai:writing.title.thinking")}
        </span>
      )}
      {suggest.isError && (
        <>
          <span className="text-destructive-foreground">
            {t(aiErrorKey(suggest.error))}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={run}>
            {t("ai:writing.preview.retry")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("ai:writing.preview.discard")}
            onClick={() => suggest.reset()}
          >
            <X />
          </Button>
        </>
      )}
      {suggest.data && (
        <>
          <Sparkles aria-hidden className="size-3 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium text-foreground text-sm">
            {suggest.data.title}
          </span>
          <Button
            type="button"
            size="xs"
            className="gap-1"
            disabled={updatePage.isPending}
            onClick={() => apply(suggest.data.title)}
          >
            <Check />
            {t("ai:writing.title.use")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("ai:writing.title.another")}
            title={t("ai:writing.title.another")}
            onClick={run}
          >
            <RotateCw />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("ai:writing.preview.discard")}
            title={t("ai:writing.preview.discard")}
            onClick={() => suggest.reset()}
          >
            <X />
          </Button>
        </>
      )}
    </div>
  );
}
