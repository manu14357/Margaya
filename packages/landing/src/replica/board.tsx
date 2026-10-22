import { CornerDownLeft, Maximize2, Plus } from "lucide-react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { StatusDot, type StatusId } from "./chips";

/** The board canvas: columns side by side. */
export function Board({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 gap-3 p-3", className)}>
      {children}
    </div>
  );
}

/**
 * One status column: header, cards, and an optional capture bar. Neutral like
 * the app's board: the header's status dot is its only colour.
 */
export function BoardColumn({
  status,
  title,
  count,
  children,
  footer,
  highlighted = false,
  className,
  "data-demo": target,
}: {
  status: StatusId;
  title: ReactNode;
  count: number;
  children?: ReactNode;
  /** e.g. the capture bar, pinned under the cards. */
  footer?: ReactNode;
  /** The drop-target outline while a card is carried over it. */
  highlighted?: boolean;
  className?: string;
  "data-demo"?: string;
}) {
  return (
    <section
      data-demo={target}
      className={cn(
        "group relative flex h-full min-h-0 w-[296px] shrink-0 flex-col rounded-xl bg-muted/50 outline-offset-[-2px] transition-[background-color,outline-color] duration-150 dark:bg-card/60",
        highlighted &&
          "bg-accent/50 outline-2 outline-primary/60 outline-dashed",
        className,
      )}
    >
      <div className="shrink-0 px-2 pt-1.5 pb-1">
        <div className="flex h-7 items-center gap-1.5">
          <StatusDot status={status} />
          <h3 className="truncate font-medium text-[13px] text-foreground">
            {title}
          </h3>
          <span className="text-muted-foreground text-xs tabular-nums">
            {count}
          </span>
          <span className="ms-auto flex size-6 items-center justify-center rounded-md text-muted-foreground">
            <Plus aria-hidden className="size-3.5" />
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-1.5 pb-1">
        {children}
      </div>
      {footer && <div className="shrink-0 px-1.5 pb-1.5">{footer}</div>}
    </section>
  );
}

/**
 * The one-line capture bar. Controlled: `value` and `active` come from the
 * scene state; `preview` is the parsed-token row shown under the input.
 */
export function CaptureBar({
  value,
  active,
  placeholder,
  ariaLabel,
  preview,
  onFocus,
  onChange,
  onSubmit,
  "data-demo": target,
}: {
  value: string;
  active: boolean;
  placeholder: string;
  ariaLabel: string;
  preview?: ReactNode;
  onFocus?: () => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  "data-demo"?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border transition-[background-color,border-color,box-shadow] duration-150",
        active ? "border-border bg-card shadow-sm" : "border-transparent",
      )}
    >
      <div className="flex h-8 items-center gap-1.5 ps-2 pe-1">
        <Plus
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        />
        <input
          data-demo={target}
          type="text"
          value={value}
          aria-label={ariaLabel}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onFocus={onFocus}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange?.(event.target.value)
          }
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit?.();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
        />
        {active && (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground">
              <Maximize2 aria-hidden className="size-3.5" />
            </span>
            <span className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground">
              <CornerDownLeft aria-hidden className="size-3.5" />
            </span>
          </>
        )}
      </div>
      {active && preview && (
        <div className="flex flex-wrap items-center gap-1 border-border/60 border-t px-2 py-1.5">
          {preview}
        </div>
      )}
    </div>
  );
}
