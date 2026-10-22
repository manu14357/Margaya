"use client";

import { ArrowRight } from "lucide-react";
import { useId } from "react";
import { useLandingCopy } from "../copy";
import { HeroWindow } from "../hero/hero-window";
import { useAfterPaint } from "../lib/after-paint";
import { LandingButton } from "../lib/button";
import { useLandingLinks } from "../links";

/**
 * The centred headline, one line and two calls to action, over one flat
 * product screen that plays the capture-to-sheet demo.
 */
export function HeroSection() {
  const hero = useLandingCopy().home.hero;
  const links = useLandingLinks();
  const titleId = useId();
  // The replica mounts after the first paint so the text paints first.
  const ready = useAfterPaint();

  return (
    <section
      aria-labelledby={titleId}
      className="px-4 pt-16 pb-20 sm:px-6 md:pt-24 md:pb-28"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h1
            id={titleId}
            className="text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] sm:text-5xl md:text-6xl"
          >
            <span className="block">{hero.title}</span>{" "}
            <span className="block">{hero.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base text-muted-foreground leading-relaxed sm:text-lg">
            {hero.description}
          </p>
          <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <LandingButton href={links.signUp} className="w-full sm:w-auto">
              {hero.primaryCta}
              <ArrowRight aria-hidden />
            </LandingButton>
            <LandingButton
              href={links.selfHost}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {hero.secondaryCta}
            </LandingButton>
          </div>
        </div>

        <HeroWindow
          ready={ready}
          className="mx-auto mt-14 max-w-5xl md:mt-20"
        />
      </div>
    </section>
  );
}
