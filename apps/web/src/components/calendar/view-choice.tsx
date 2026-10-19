import type { JSX } from "react";
import { cn } from "@/lib/cn";

type ViewChoiceProps<TValue extends string> = {
  /** Names the group for screen readers. */
  label: string;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
};

const BUTTON_CLASS =
  "inline-flex h-6 items-center rounded-[5px] px-2.5 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

/** One segment: the pressed one is filled with the primary colour. */
export function viewChoiceButtonClass(active: boolean) {
  return cn(
    BUTTON_CLASS,
    active
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:bg-background hover:text-foreground",
  );
}

/** The tray a segmented control (or a lone toggle) sits in. */
export const VIEW_CHOICE_TRAY_CLASS =
  "inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/60 p-0.5";

/**
 * A segmented control of pressed-state buttons, for the calendar's
 * Month/Week and the timeline's zoom.
 */
export default function ViewChoice<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: ViewChoiceProps<TValue>): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and legend into a toolbar row.
    <div role="group" aria-label={label} className={VIEW_CHOICE_TRAY_CLASS}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={viewChoiceButtonClass(option.value === value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
