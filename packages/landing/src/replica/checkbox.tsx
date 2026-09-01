import { Check } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * The app's checkbox (row selection in the list and spreadsheet): a small
 * rounded square that fills with `--primary` when checked.
 */
export function ReplicaCheckbox({
  checked,
  label,
  onChange,
  className,
  "data-demo": target,
}: {
  checked: boolean;
  /** The accessible name, e.g. "Select WEB-31". */
  label: string;
  onChange?: () => void;
  className?: string;
  "data-demo"?: string;
}) {
  return (
    <span
      data-demo={target}
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center rounded-[.25rem] border transition-[background-color,border-color,opacity] duration-150 has-focus-visible:ring-2 has-focus-visible:ring-ring",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background shadow-xs/5 dark:bg-input/32",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={() => onChange?.()}
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-0 cursor-pointer appearance-none rounded-[.25rem] outline-none"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className={cn(
          "pointer-events-none size-3 transition-[opacity,scale] duration-150",
          checked ? "scale-100 opacity-100" : "scale-90 opacity-0",
        )}
      />
    </span>
  );
}
