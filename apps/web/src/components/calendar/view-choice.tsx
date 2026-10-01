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
  "inline-flex h-6 items-center rounded-md px-2 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function viewChoiceButtonClass(active: boolean) {
  return cn(
    BUTTON_CLASS,
    active
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );
}

/**
 * A small set of pressed-state buttons with the layout toggle's look, for
 * the calendar's Month/Week and the timeline's zoom.
 */
export default function ViewChoice<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: ViewChoiceProps<TValue>): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and legend into a toolbar row.
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5"
    >
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
