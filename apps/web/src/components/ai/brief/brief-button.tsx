import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Copy,
  FilePlus2,
  Megaphone,
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
import { Spinner } from "@/components/ui/spinner";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import {
  type BriefAudience,
  type BriefMeta,
  type BriefScopeType,
  isBriefMeta,
  shareBrief,
  streamBrief,
} from "@/fetchers/ai/brief";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { linkCitations } from "@/lib/ai/brief-citations";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { generateLink } from "@/lib/generate-link";
import { toast } from "@/lib/toast";
import BriefFactsSummary from "./brief-facts";

// Stakeholder briefs (B8): written from computed facts only, cited by task
// key, with what changed since the last shared brief. Saving as a page or
// copying marks the brief as shared, so the next one diffs against it.

const AUDIENCES: BriefAudience[] = ["team", "leadership", "client"];

type BriefButtonProps = {
  scopeType: BriefScopeType;
  /** The cycle, module or project. */
  scopeId: string;
  projectId: string;
  workspaceId: string;
  /** Its name, for the saved page's title. */
  name: string;
  className?: string;
};

/** "Brief" for a cycle, module or project. Hidden while AI is off. */
export default function BriefButton({
  scopeType,
  scopeId,
  projectId,
  workspaceId,
  name,
  className,
}: BriefButtonProps) {
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
        aria-label={t("ai:brief.buttonLabel")}
        title={t("ai:brief.buttonLabel")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Megaphone className="size-3 text-muted-foreground" />
        <span className="hidden md:inline">{t("ai:brief.button")}</span>
      </Button>
      {open && (
        <BriefCard
          scopeType={scopeType}
          scopeId={scopeId}
          projectId={projectId}
          workspaceId={workspaceId}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function BriefCard({
  scopeType,
  scopeId,
  projectId,
  workspaceId,
  name,
  onClose,
}: Omit<BriefButtonProps, "className"> & { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [audience, setAudience] = useState<BriefAudience>("team");
  const [meta, setMeta] = useState<BriefMeta | null>(null);
  const [copied, setCopied] = useState(false);
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { canCreatePages } = useWorkspacePermission();
  const createPage = useCreatePage();
  const { status, text, errorKey } = stream;
  const canSave = isEnabled("pages") && canCreatePages();
  const finished = status === "done" && text.trim().length > 0 && meta;

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const write = () => {
    setMeta(null);
    void stream.start((handlers) =>
      streamBrief(
        {
          workspaceId,
          scopeType,
          scopeId,
          audience,
          ...(locale ? { locale } : {}),
        },
        {
          ...handlers,
          onMeta: (value) => {
            if (isBriefMeta(value)) setMeta(value);
          },
        },
      ),
    );
  };

  const markShared = (pageId?: string) => {
    if (!meta) return;
    // Best effort: the brief is already where it is needed.
    void shareBrief({ briefId: meta.briefId, pageId }).catch(() => {});
  };

  const absolute = () =>
    meta ? linkCitations(text, meta.citations, generateLink()) : text;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absolute());
      setCopied(true);
      markShared();
    } catch {
      toast.error(t("ai:brief.copyError"));
    }
  };

  const save = () => {
    createPage.mutate(
      {
        projectId,
        title: t("ai:brief.pageTitle", {
          name: name.slice(0, 160),
          date: formatDateMedium(new Date()),
        }),
        content: absolute(),
        aiAssist: { feature: "brief" },
      },
      {
        onSuccess: (page) => {
          markShared(page.id);
          toast.success(t("ai:brief.saved"), {
            action: {
              label: t("ai:brief.openPage"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
                  params: { workspaceId, projectId, pageId: page.id },
                }),
            },
          });
        },
        onError: () => toast.error(t("ai:brief.saveError")),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      stream.reset();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-label={t("ai:brief.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-x-4 top-16 z-40 flex max-h-[75vh] flex-col rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none sm:inset-x-auto sm:right-4 sm:w-[30rem]"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {t("ai:brief.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("ai:brief.close")}
          title={t("ai:brief.close")}
          onClick={() => {
            stream.reset();
            onClose();
          }}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span id="ai-brief-audience" className="text-muted-foreground text-xs">
          {t("ai:brief.audience")}
        </span>
        <ToggleGroup
          size="sm"
          variant="outline"
          aria-labelledby="ai-brief-audience"
          disabled={status === "streaming"}
          value={[audience]}
          onValueChange={(values) => {
            const next = AUDIENCES.find((value) => value === values[0]);
            if (next) setAudience(next);
          }}
        >
          {AUDIENCES.map((value) => (
            <Toggle key={value} value={value}>
              {t(`ai:brief.audiences.${value}`)}
            </Toggle>
          ))}
        </ToggleGroup>
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="ms-auto gap-1"
          disabled={status === "streaming"}
          onClick={write}
        >
          {status === "idle" ? (
            <Sparkles className="size-3 text-muted-foreground" />
          ) : (
            <RotateCw className="size-3" />
          )}
          {status === "idle"
            ? t("ai:brief.generate")
            : t("ai:brief.regenerate")}
        </Button>
      </div>

      <div
        className="min-h-16 overflow-y-auto px-3 py-2"
        aria-live="polite"
        aria-busy={status === "streaming"}
      >
        {status === "idle" ? (
          <p className="text-muted-foreground text-sm">{t("ai:brief.intro")}</p>
        ) : status === "error" ? (
          <p role="alert" className="text-destructive-foreground text-sm">
            {t(errorKey ?? "ai:errors.unknown")}
          </p>
        ) : text ? (
          <AiMarkdown
            text={meta ? linkCitations(text, meta.citations) : text}
          />
        ) : (
          <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-3.5" />
            {t("ai:brief.writing")}
          </span>
        )}
        {meta && (
          <details className="mt-3 rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <summary className="cursor-pointer text-muted-foreground text-xs">
              {t("ai:brief.facts.title")}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <BriefFactsSummary facts={meta.facts} />
              <p className="text-muted-foreground text-xs">
                {t("ai:brief.facts.note")}
              </p>
            </div>
          </details>
        )}
      </div>

      {status !== "idle" && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {status === "streaming" ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={stream.stop}
            >
              {t("ai:brief.stop")}
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
                {copied ? t("ai:brief.copied") : t("ai:brief.copy")}
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
                  {t("ai:brief.saveAsPage")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
