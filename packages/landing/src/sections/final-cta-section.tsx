"use client";

import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useLandingCopy } from "../copy";
import { LandingLink, useLandingLinks } from "../links";

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary";

/** The closing band: one inverted panel with both ways to start. */
export function FinalCtaSection() {
  const cta = useLandingCopy().home.finalCta;
  const links = useLandingLinks();
  const titleId = useId();

  return (
    <section
      id="get-started"
      aria-labelledby={titleId}
      className="scroll-mt-20 px-4 pb-20 md:px-6 md:pb-28"
    >
      <div className="mx-auto w-full max-w-6xl rounded-2xl bg-primary px-6 py-14 text-center text-primary-foreground md:px-12 md:py-20">
        <h2
          id={titleId}
          className="mx-auto max-w-2xl text-balance font-medium text-3xl leading-tight md:text-4xl"
        >
          {cta.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-balance text-lg leading-relaxed opacity-75">
          {cta.description}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LandingLink
            href={links.signUp}
            className={`inline-flex h-12 items-center gap-2 rounded-lg bg-primary-foreground px-5 font-medium text-primary text-sm transition-opacity hover:opacity-90 ${FOCUS}`}
          >
            {cta.primary}
            <ArrowRight aria-hidden className="size-4" />
          </LandingLink>
          <LandingLink
            href={links.selfHost}
            className={`inline-flex h-12 items-center rounded-lg border border-primary-foreground/25 px-5 font-medium text-sm transition-colors hover:bg-primary-foreground/10 ${FOCUS}`}
          >
            {cta.secondary}
          </LandingLink>
        </div>
        <p className="mt-5 text-xs opacity-60">{cta.note}</p>
      </div>
    </section>
  );
}
