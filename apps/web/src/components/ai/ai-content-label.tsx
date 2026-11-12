import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type AiProvenance, aiFeatureKey } from "@/lib/ai/provenance";
import { cn } from "@/lib/cn";

/**
 * The "AI-generated" label (EU AI Act Article 50) on a task description,
 * comment or page that AI wrote: a muted outline chip readable without
 * colour, which says who or what wrote it. After a person's change it reads
 * "Edited by X, originally AI-generated".
 */
export function AiContentLabel({
  provenance,
  className,
}: {
  provenance: AiProvenance | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!provenance) return null;

  const label = provenance.editedById
    ? t("ai:provenance.edited", {
        name: provenance.editedByName || t("ai:provenance.someone"),
      })
    : t("ai:provenance.label");
  const featureKey = aiFeatureKey(provenance.feature);
  const source =
    provenance.source === "agent"
      ? t("ai:provenance.byAgent", {
          name: provenance.agentName || t("ai:provenance.unknownAgent"),
        })
      : featureKey
        ? t("ai:provenance.byFeature", { feature: t(featureKey) })
        : t("ai:provenance.byAssist");
  const details = [
    source,
    provenance.model
      ? t("ai:provenance.model", { model: provenance.model })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={details}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded border border-border px-1.5 font-medium text-[11px] text-muted-foreground leading-5",
        className,
      )}
    >
      <Sparkles className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <span className="sr-only">{`. ${details}`}</span>
    </span>
  );
}

/** The plain "AI-generated" chip, for AI answers shown outside a saved item. */
export function AiGeneratedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded border border-border px-1.5 font-medium text-[11px] text-muted-foreground leading-5",
        className,
      )}
    >
      <Sparkles className="size-3 shrink-0" aria-hidden />
      {t("ai:provenance.label")}
    </span>
  );
}
