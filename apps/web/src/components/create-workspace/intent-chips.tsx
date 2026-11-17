import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import {
  INTENT_CHIPS,
  MORE_INTENT_CHIPS,
} from "@/lib/project-template-gallery";

/**
 * "What will you track first?": one optional choice that only orders the
 * template recommendations. Pressing the chosen chip again clears it.
 */
export function IntentChips({
  value,
  onChange,
  disabled,
  visuallyHiddenLegend = false,
}: {
  /** The gallery category of the chosen chip, or null. */
  value: string | null;
  onChange: (category: string | null) => void;
  disabled?: boolean;
  /** When a surrounding trigger already shows the question, keep the legend for screen readers only. */
  visuallyHiddenLegend?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const moreChosen = MORE_INTENT_CHIPS.some((chip) => chip.category === value);
  const [moreOpen, setMoreOpen] = useState(moreChosen);

  const chip = (item: { id: string; category: string; labelKey: string }) => {
    const pressed = value === item.category;
    return (
      <button
        key={item.id}
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onChange(pressed ? null : item.category)}
        className={cn(
          "inline-flex min-h-11 items-center rounded-full border px-3 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64 sm:min-h-8",
          pressed
            ? "border-primary bg-primary/10 font-medium text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {t(item.labelKey)}
      </button>
    );
  };

  return (
    <fieldset className="space-y-2" aria-describedby={`${id}-hint`}>
      <legend
        className={
          visuallyHiddenLegend
            ? "sr-only"
            : "font-medium text-foreground text-sm"
        }
      >
        {t("auth:onboarding.intent.legend")}
      </legend>
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {t("auth:onboarding.intent.hint")}
      </p>
      <div className="flex flex-wrap gap-2">{INTENT_CHIPS.map(chip)}</div>
      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger className="flex min-h-11 items-center gap-1 rounded-md text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&[data-panel-open]>svg]:rotate-90">
          <ChevronRight
            className="size-4 transition-transform duration-150"
            aria-hidden
          />
          {t("auth:onboarding.intent.more")}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-wrap gap-2 pt-2">
            {MORE_INTENT_CHIPS.map(chip)}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </fieldset>
  );
}
