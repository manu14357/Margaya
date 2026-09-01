import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** The pressed-state look shared by the calendar's Month/Week and the Gantt zoom. */
export function viewChoiceClass(active: boolean) {
  return cn(
    "inline-flex h-6 cursor-pointer items-center rounded-md px-2 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );
}

/**
 * A small group of pressed-state buttons, like the app's `ViewChoice`.
 * Each option is a `data-demo="<prefix>-<value>"` target.
 */
export function ViewChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  demoPrefix,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange?: (value: T) => void;
  /** Target names: `${demoPrefix}-${value}`. */
  demoPrefix?: string;
}) {
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
          data-demo={demoPrefix ? `${demoPrefix}-${option.value}` : undefined}
          onClick={() => onChange?.(option.value)}
          className={viewChoiceClass(option.value === value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The Board/List segmented switch of the board toolbar. */
export function LayoutToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode; icon: LucideIcon }[];
  value: T;
  onChange?: (value: T) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and legend into a toolbar row.
    <div
      role="group"
      aria-label={label}
      className="inline-flex min-w-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {options.map(({ value: id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === value}
          onClick={() => onChange?.(id)}
          className={cn(
            "inline-flex h-6 cursor-pointer items-center gap-1 rounded px-2 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            id === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-3" />
          {text}
        </button>
      ))}
    </div>
  );
}
