"use client";

import { type ReactNode, useId } from "react";
import { useLandingCopy } from "../copy";
import { cn } from "../lib/cn";

export type SectionCopy = {
  eyebrow?: string;
  title: string;
  description?: string;
};

/**
 * The frame every home section uses: an anchor id, the eyebrow, title and
 * description, then the section's own content.
 */
export function LandingSection({
  id,
  copy,
  children,
  className,
  align = "start",
}: {
  /** The in-page anchor, e.g. "views" for `#views`. */
  id: string;
  copy: SectionCopy;
  children?: ReactNode;
  className?: string;
  align?: "start" | "center";
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn("scroll-mt-20 px-6 py-20 md:py-28", className)}
    >
      <div className="mx-auto w-full max-w-6xl">
        <header
          className={cn(
            "max-w-2xl",
            align === "center" && "mx-auto text-center",
          )}
        >
          {copy.eyebrow && (
            <p className="font-medium text-muted-foreground text-sm">
              {copy.eyebrow}
            </p>
          )}
          <h2
            id={titleId}
            className="mt-2 text-balance font-medium text-3xl leading-tight md:text-4xl"
          >
            {copy.title}
          </h2>
          {copy.description && (
            <p className="mt-4 text-balance text-lg text-muted-foreground leading-relaxed">
              {copy.description}
            </p>
          )}
        </header>
        {children && <div className="mt-12">{children}</div>}
      </div>
    </section>
  );
}

/**
 * A placeholder for a section another lane is building. It renders the
 * section's heading and a marked, empty slot. Replace the whole component
 * body when the real section lands.
 */
export function SectionStub({
  id,
  copy,
  owner,
}: {
  id: string;
  copy: SectionCopy;
  /** The lane that owns the section, e.g. "L2". */
  owner: string;
}) {
  const placeholder = useLandingCopy().home.placeholder;
  return (
    <LandingSection id={id} copy={copy}>
      <div
        data-stub={owner}
        className="flex aspect-[16/7] w-full items-center justify-center rounded-xl border border-border border-dashed bg-muted/30 text-muted-foreground text-sm"
      >
        {placeholder}
      </div>
    </LandingSection>
  );
}
