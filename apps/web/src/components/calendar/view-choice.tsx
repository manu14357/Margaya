import type { JSX } from "react";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";

type ViewChoiceProps<TValue extends string> = {
  /** Names the group for screen readers. */
  label: string;
  options: ReadonlyArray<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
};

/**
 * The shared segmented control from a list of options, for the calendar's
 * Month/Week and the timeline's zoom.
 */
export default function ViewChoice<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: ViewChoiceProps<TValue>): JSX.Element {
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        // Pressing the chosen segment empties the group; the choice stays.
        const next = options.find((option) => option.value === values[0]);
        if (next) onChange(next.value);
      }}
    >
      {options.map((option) => (
        <Toggle key={option.value} value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
