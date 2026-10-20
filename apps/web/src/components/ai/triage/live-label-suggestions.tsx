import { Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import {
  type DraftLabelSuggestions,
  suggestDraftLabels,
} from "@/fetchers/ai/triage";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { resolveLabelColor } from "@/lib/label-color";

/** Suggestions wait for this long a pause in typing. */
export const LABEL_SUGGEST_DELAY_MS = 1500;

type SuggestedLabel = DraftLabelSuggestions["labels"][number];

/**
 * Label chips suggested while a task is written: after a 1.5 s pause in
 * the title or description, up to three workspace labels, each added with
 * one click. Quiet: nothing shows while asking, and errors stay silent.
 */
export default function LiveLabelSuggestions({
  projectId,
  title,
  description,
  selectedLabelIds,
  enabled = true,
  onAdd,
}: {
  projectId: string;
  title: string;
  description: string;
  selectedLabelIds: readonly string[];
  /** The person may add labels here. */
  enabled?: boolean;
  onAdd: (label: { id: string; name: string; color: string }) => void;
}) {
  const { t } = useTranslation();
  const locale = useAiLocale();
  const { available } = useAiAvailability(projectId || null);
  const [suggestions, setSuggestions] = useState<SuggestedLabel[]>([]);
  const selectedRef = useRef(selectedLabelIds);
  selectedRef.current = selectedLabelIds;
  const active = enabled && available && Boolean(projectId);
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();

  useEffect(() => {
    if (!active || trimmedTitle.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestDraftLabels(
        {
          projectId,
          title: trimmedTitle.slice(0, 255),
          ...(trimmedDescription
            ? { description: trimmedDescription.slice(0, 10_000) }
            : {}),
          ...(selectedRef.current.length
            ? { labelIds: selectedRef.current.slice(0, 50) }
            : {}),
          ...(locale ? { locale } : {}),
        },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) setSuggestions(result.labels);
        })
        .catch(() => {
          // Suggestions are optional; the form works without them.
        });
    }, LABEL_SUGGEST_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, projectId, trimmedTitle, trimmedDescription, locale]);

  const visible = suggestions.filter(
    (label) => !selectedLabelIds.includes(label.labelId),
  );
  if (!active || visible.length === 0) return null;

  return (
    <section
      aria-label={t("ai:triage.liveLabels.title")}
      aria-live="polite"
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Sparkles aria-hidden className="size-3" />
        {t("ai:triage.liveLabels.title")}
      </span>
      {visible.map((label) => (
        <button
          key={label.labelId}
          type="button"
          title={label.reason ?? undefined}
          aria-label={t("ai:triage.liveLabels.add", { name: label.name })}
          onClick={() =>
            onAdd({ id: label.labelId, name: label.name, color: label.color })
          }
          className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed px-2 text-xs transition-colors hover:border-solid hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: resolveLabelColor(label.color) }}
          />
          <span className="max-w-32 truncate">{label.name}</span>
          <Plus aria-hidden className="size-3 text-muted-foreground" />
        </button>
      ))}
    </section>
  );
}
