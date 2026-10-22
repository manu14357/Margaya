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
 * The frame every landing section uses: an anchor id, a quiet eyebrow, the
 * title and one line of description, then the section's own content. Every
 * section shares the same rhythm, so pages read as one calm column.
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
      className={cn("scroll-mt-20 px-4 py-20 sm:px-6 md:py-28", className)}
    >
      <div className="mx-auto w-full max-w-6xl">
        <header
          className={cn(
            "max-w-2xl",
            align === "center" && "mx-auto text-center",
          )}
        >
          {copy.eyebrow && (
            <p className="mb-3 font-medium text-muted-foreground text-sm">
              {copy.eyebrow}
            </p>
          )}
          <h2
            id={titleId}
            className="text-balance font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-[2.5rem]"
          >
            {copy.title}
          </h2>
          {copy.description && (
            <p className="mt-4 text-pretty text-base text-muted-foreground leading-relaxed md:text-lg">
              {copy.description}
            </p>
          )}
        </header>
        {children && <div className="mt-10 md:mt-14">{children}</div>}
      </div>
    </section>
  );
}

/**
 * A secondary point inside a section: a small heading and one line, then
 * its own content (a preview, a list). Sits beside a screen.
 */
export function LandingSectionDetail({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="font-medium text-base text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 text-pretty text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
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
        className="flex aspect-[16/7] w-full items-center justify-center rounded-xl border border-border border-dashed text-muted-foreground text-sm"
      >
        {placeholder}
      </div>
    </LandingSection>
  );
}
