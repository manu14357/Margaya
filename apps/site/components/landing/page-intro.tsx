import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page heading for public pages, on the same type scale as the home hero.
 * `center` suits marketing pages; `start` suits reading pages whose body
 * sits in a left-aligned column.
 */
export function PageIntro({
  eyebrow,
  title,
  description,
  children,
  className,
  align = "start",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  align?: "start" | "center";
}) {
  const center = align === "center";
  return (
    <header
      className={cn(
        "max-w-3xl",
        center && "mx-auto flex flex-col items-center text-center",
        className,
      )}
    >
      {eyebrow ? (
        <div className="font-medium text-muted-foreground text-sm">
          {eyebrow}
        </div>
      ) : null}
      <h1
        className={cn(
          "text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] md:text-[3.5rem]",
          eyebrow ? "mt-3" : null,
        )}
      >
        {title}
      </h1>
      {description ? (
        <p
          className={cn(
            "mt-5 max-w-2xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg",
            center && "max-w-xl",
          )}
        >
          {description}
        </p>
      ) : null}
      {children}
    </header>
  );
}
