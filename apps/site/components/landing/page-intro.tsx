import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page heading for public pages; matches the landing hero and sections. */
export function PageIntro({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("max-w-3xl", className)}>
      {eyebrow ? (
        <div className="font-medium text-muted-foreground text-sm">
          {eyebrow}
        </div>
      ) : null}
      <h1
        className={cn(
          "text-balance font-medium text-4xl leading-[1.06] md:text-5xl",
          eyebrow ? "mt-3" : null,
        )}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
          {description}
        </p>
      ) : null}
      {children}
    </header>
  );
}
