import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/*
 * The settings page frame, modelled on the app's settings layout: a
 * reading-width column with a page header, then titled sections of
 * bordered, hairline-divided groups.
 */

/** A settings page: title, description, header actions, then content. */
export function SettingsFrame({
  title,
  description,
  actions,
  children,
  wide = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** The wide variant, for tables such as the audit log. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-6 pt-6 pb-10",
        wide ? "max-w-5xl" : "max-w-3xl",
        className,
      )}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-semibold text-foreground text-xl leading-7">
            {title}
          </h1>
          {description && (
            <p className="text-[13px] text-muted-foreground leading-5">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

/** A titled group of settings. */
export function SettingsBlock({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {title && (
        <h2 className="font-semibold text-foreground text-sm leading-5">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** A bordered list of rows, divided by hairlines. */
export function SettingsBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}
