import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PageHeaderProps = {
  title: ReactNode;
  /** One plain sentence under the title. */
  description?: ReactNode;
  /** A leading tile or icon. */
  icon?: ReactNode;
  /** Right-aligned actions; at most one primary. */
  actions?: ReactNode;
  /** Extra content under the description (meta chips, progress). */
  children?: ReactNode;
  className?: string;
};

/**
 * A heading block at the top of a page's content (inside ContentArea), for
 * pages whose top bar only names the place: settings pages, a cycle, a
 * module. Compact: 18px title, 13px description.
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-2 pb-4", className)}
      data-slot="page-header"
    >
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-foreground text-lg leading-7">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground leading-5">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
