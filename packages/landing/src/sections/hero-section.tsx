"use client";

import { ArrowRight } from "lucide-react";
import { useLandingCopy } from "../copy";
import { LandingButton } from "../lib/button";
import { useLandingLinks } from "../links";
import { HeroDemo } from "../scenes";

/** Owner: L1. Headline, CTAs and the capture-to-sheet demo. */
export function HeroSection() {
  const { hero } = useLandingCopy().home;
  const links = useLandingLinks();
  return (
    <section className="relative overflow-hidden px-6 pt-14 pb-16 md:pt-20 md:pb-20">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-3xl">
          <p className="font-medium text-muted-foreground text-sm">
            {hero.eyebrow}
          </p>
          <h1 className="mt-3 text-balance font-medium text-4xl leading-[1.06] md:text-6xl">
            {hero.title}{" "}
            <span className="text-muted-foreground md:block">
              {hero.titleAccent}
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
            {hero.description}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <LandingButton href={links.signUp}>
              {hero.primaryCta}
              <ArrowRight aria-hidden />
            </LandingButton>
            <LandingButton href={links.selfHost} variant="outline">
              {hero.secondaryCta}
            </LandingButton>
          </div>
          <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
            {hero.note}
          </p>
        </div>
        <HeroDemo className="mt-12 md:mt-16" />
      </div>
    </section>
  );
}
