import { useNavigate } from "@tanstack/react-router";
import {
  FilePlus2,
  MessagesSquare,
  Pencil,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  citationsOf,
  type InsightCitation,
  type RetroFacts,
  streamRetroNarrative,
} from "@/fetchers/insight/insight";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useRetroFacts } from "@/hooks/queries/insight/use-insight";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { linkCitations } from "@/lib/ai/brief-citations";
import { cn } from "@/lib/cn";
import { generateLink } from "@/lib/generate-link";
import { retroFactLines, retroMarkdown } from "@/lib/insight/retro-markdown";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";

type RetroButtonProps = {
  cycle: Pick<Cycle, "id" | "name" | "projectId" | "status" | "startDate">;
  workspaceId: string;
  className?: string;
};

/** Whether the cycle offers a retro: running or ended, to analytics readers. */
export function useCanRetro(cycle: RetroButtonProps["cycle"]): boolean {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  const eligible =
    cycle.startDate !== null &&
    (cycle.status === "completed" || cycle.status === "current");
  return eligible && !isCheckingPermissions && canReadAnalytics();
}

/**
 * "Retro" on a running or ended cycle (#15): the computed fact sheet,
 * optionally an AI narrative with discussion questions, saved as a Page.
 * Shown to people who may read analytics.
 */
export default function RetroButton({
  cycle,
  workspaceId,
  className,
}: RetroButtonProps) {
  const { t } = useTranslation();
  const canRetro = useCanRetro(cycle);
  const [open, setOpen] = useState(false);
  if (!canRetro) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className={cn("gap-1", className)}
        aria-label={t("insight:retro.buttonLabel")}
        title={t("insight:retro.buttonLabel")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MessagesSquare className="size-3 text-muted-foreground" />
        <span className="hidden md:inline">{t("insight:retro.button")}</span>
      </Button>
      {open && (
        <RetroCard
          cycle={cycle}
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function RetroCard({
  cycle,
  workspaceId,
  onClose,
}: Omit<RetroButtonProps, "className"> & { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [citations, setCitations] = useState<InsightCitation[]>([]);
  const [editing, setEditing] = useState(false);
  const { available } = useAiAvailability(cycle.projectId);
  const {
    data: facts,
    isPending,
    isError,
  } = useRetroFacts(cycle.projectId, cycle.id);
  const { isEnabled } = useProjectFeatures({
    projectId: cycle.projectId,
    workspaceId,
  });
  const { canCreatePages } = useWorkspacePermission();
  const createPage = useCreatePage();
  const canSave = isEnabled("pages") && canCreatePages();
  const { status, text, errorKey } = stream;

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const write = () => {
    setEditing(false);
    void stream.start((handlers) =>
      streamRetroNarrative(
        {
          workspaceId,
          cycleId: cycle.id,
          ...(locale ? { locale } : {}),
        },
        { ...handlers, onMeta: (meta) => setCitations(citationsOf(meta)) },
      ),
    );
  };

  const save = (sheet: RetroFacts) => {
    const narrative =
      status === "done" && text.trim()
        ? linkCitations(text, citations, generateLink())
        : undefined;
    createPage.mutate(
      {
        projectId: cycle.projectId,
        title: t("insight:retro.pageTitle", { name: cycle.name.slice(0, 160) }),
        content: retroMarkdown(sheet, t, narrative),
      },
      {
        onSuccess: (page) => {
          toast.success(t("insight:retro.saved"), {
            action: {
              label: t("insight:retro.openPage"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: {
                    workspaceId,
                    projectId: cycle.projectId,
                    pageId: page.id,
                  },
                }),
            },
          });
        },
        onError: () => toast.error(t("insight:retro.saveError")),
      },
    );
  };

  const close = () => {
    stream.reset();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-label={t("insight:retro.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-x-4 top-16 z-40 flex max-h-[75vh] flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none sm:inset-x-auto sm:right-4 sm:w-[30rem]"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessagesSquare
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("insight:retro.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("insight:close")}
          title={t("insight:close")}
          onClick={close}
        >
          <X />
        </Button>
      </div>

      <div className="min-h-16 space-y-3 overflow-y-auto px-3 py-2">
        {isPending ? (
          <Skeleton className="h-28 rounded-md" />
        ) : isError || !facts ? (
          <p role="alert" className="text-destructive-foreground text-sm">
            {t("insight:retro.error")}
          </p>
        ) : (
          <section aria-labelledby="retro-facts" className="space-y-1.5">
            <h3
              id="retro-facts"
              className="font-medium text-muted-foreground text-xs"
            >
              {facts.cycle.status === "completed"
                ? t("insight:retro.factsTitle")
                : t("insight:retro.factsSoFar")}
            </h3>
            <ul className="list-disc space-y-0.5 ps-4 text-sm">
              {retroFactLines(facts, t).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {t("insight:retro.factsNote")}
            </p>
          </section>
        )}

        {available && facts && (
          <section
            aria-live="polite"
            aria-busy={status === "streaming"}
            className="space-y-2 rounded-md border bg-muted/30 px-2.5 py-2"
          >
            {status === "idle" ? (
              <p className="text-muted-foreground text-xs">
                {t("insight:retro.aiIntro")}
              </p>
            ) : status === "error" ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {t(errorKey ?? "ai:errors.unknown")}
              </p>
            ) : editing ? (
              <Textarea
                aria-label={t("insight:retro.editLabel")}
                value={text}
                rows={10}
                onChange={(event) => stream.setText(event.target.value)}
              />
            ) : text ? (
              <AiMarkdown text={linkCitations(text, citations)} />
            ) : (
              <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-3.5" />
                {t("insight:writing")}
              </span>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {status === "streaming" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={stream.stop}
                >
                  {t("insight:stop")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="gap-1"
                  onClick={write}
                >
                  {status === "idle" ? (
                    <Sparkles className="size-3 text-muted-foreground" />
                  ) : (
                    <RotateCw className="size-3" />
                  )}
                  {status === "idle"
                    ? t("insight:retro.write")
                    : t("insight:retro.rewrite")}
                </Button>
              )}
              {status === "done" && text && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="gap-1"
                  aria-pressed={editing}
                  onClick={() => setEditing((value) => !value)}
                >
                  <Pencil className="size-3" />
                  {editing
                    ? t("insight:retro.preview")
                    : t("insight:retro.edit")}
                </Button>
              )}
            </div>
          </section>
        )}
      </div>

      {facts && canSave && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={createPage.isPending || status === "streaming"}
            onClick={() => save(facts)}
          >
            <FilePlus2 />
            {t("insight:retro.saveAsPage")}
          </Button>
          <span className="text-muted-foreground text-xs">
            {status === "done" && text
              ? t("insight:retro.saveWithNarrative")
              : t("insight:retro.saveFactsOnly")}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
