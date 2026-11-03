"use client";

import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useLandingCopy } from "../copy";
import { LandingButton } from "../lib/button";
import { useLandingLinks } from "../links";

/** The closing call to action: a centred heading, the install guide and the docs. */
export function FinalCtaSection() {
  const cta = useLandingCopy().home.finalCta;
  const links = useLandingLinks();
  const titleId = useId();

  return (
    <section
      id="get-started"
      aria-labelledby={titleId}
      className="scroll-mt-20 px-4 pb-20 sm:px-6 md:pb-28"
    >
      <div className="mx-auto w-full max-w-6xl rounded-2xl border border-border bg-card px-6 py-16 text-center md:px-12 md:py-20">
        <h2
          id={titleId}
          className="mx-auto max-w-2xl text-balance font-medium text-3xl leading-[1.15] tracking-[-0.02em] md:text-[2.5rem]"
        >
          {cta.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed md:text-lg">
          {cta.description}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <LandingButton href={links.selfHost} className="w-full sm:w-auto">
            {cta.primary}
            <ArrowRight aria-hidden />
          </LandingButton>
          <LandingButton
            href={links.docs}
            variant="outline"
            className="w-full sm:w-auto"
          >
            {cta.secondary}
          </LandingButton>
        </div>
        <p className="mt-5 text-muted-foreground text-xs">{cta.note}</p>
      </div>
    </section>
  );
}
