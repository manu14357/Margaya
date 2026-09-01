import { Check, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type PopoverOption = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
};

/**
 * A property picker like the app's status / priority / assignee popovers.
 * Position it yourself (e.g. `absolute top-8 left-0`). Each option is a
 * `data-demo="option-<id>"` target.
 */
export function PropertyPopover({
  options,
  searchPlaceholder,
  highlighted,
  onSelect,
  className,
  "data-demo": target,
}: {
  options: readonly PopoverOption[];
  /** Shows the filter field at the top when given. */
  searchPlaceholder?: string;
  /** The option under the keyboard or cursor. */
  highlighted?: string;
  onSelect?: (id: string) => void;
  className?: string;
  "data-demo"?: string;
}) {
  return (
    <div
      data-demo={target}
      className={cn(
        "z-30 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg/5",
        className,
      )}
    >
      {searchPlaceholder && (
        <div className="mb-1 flex h-8 items-center gap-2 border-border border-b px-2 text-muted-foreground text-sm">
          <Search aria-hidden className="size-3.5" />
          <span className="truncate">{searchPlaceholder}</span>
        </div>
      )}
      <ul className="flex flex-col">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              data-demo={`option-${option.id}`}
              onClick={() => onSelect?.(option.id)}
              className={cn(
                "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                highlighted === option.id && "bg-accent",
              )}
            >
              {option.icon}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.selected && (
                <Check aria-hidden className="size-3.5 text-foreground" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
