import { cva, type VariantProps } from "class-variance-authority";

import { EmptyBackdrop } from "@/components/illustrations/empty-backdrop";
import { cn } from "@/lib/cn";

// Empty states invite rather than apologise: an illustration, a title, one
// sentence and one primary action, in a compact column. Existing call sites
// compose these parts directly; `EmptyState` is the one-call shorthand.

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 text-balance p-6 text-center md:p-8",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex max-w-sm flex-col items-center text-center",
        className,
      )}
      data-slot="empty-header"
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "relative flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card not-dark:bg-clip-padding text-foreground shadow-sm/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='size-'])]:size-5",
        illustration:
          "text-muted-foreground [&_svg:not([class*='w-'])]:w-44 [&_svg]:h-auto",
      },
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  if (variant === "icon") {
    // The icon tile sits in a small drawn clearing so every icon-based empty
    // state reads as an illustration.
    return (
      <div
        className="relative mb-3 flex h-18 w-30 shrink-0 items-center justify-center"
        data-slot="empty-media"
        data-variant={variant}
        {...props}
      >
        <EmptyBackdrop className="absolute inset-0 size-full text-muted-foreground" />
        <div
          className={cn(emptyMediaVariants({ variant }), "-mt-3", className)}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative mb-3",
        emptyMediaVariants({ variant }),
        className,
      )}
      data-slot="empty-media"
      data-variant={variant}
      {...props}
    >
      {children}
    </div>
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("font-heading font-semibold text-lg", className)}
      data-slot="empty-title"
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      className={cn(
        "max-w-[44ch] text-muted-foreground text-sm [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-3 text-balance text-sm",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** A drawing from `components/illustrations`; it wins over `icon`. */
  illustration?: React.ReactNode;
  /** A lucide icon element, shown in a tile on a drawn clearing. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The one primary action; extra actions sit beside it, quieter. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  footer?: React.ReactNode;
};

/** The standard composition: illustration, title, one sentence, one action. */
function EmptyState({
  illustration,
  icon,
  title,
  description,
  action,
  secondaryAction,
  footer,
  ...props
}: EmptyStateProps) {
  return (
    <Empty {...props}>
      <EmptyHeader>
        {illustration ? (
          <EmptyMedia variant="illustration">{illustration}</EmptyMedia>
        ) : icon ? (
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(action || secondaryAction) && (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          {action}
          {secondaryAction}
        </EmptyContent>
      )}
      {footer}
    </Empty>
  );
}

export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyState,
  EmptyTitle,
};
