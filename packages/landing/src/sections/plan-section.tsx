"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { CyclesDemo, EstimatesPreview, ModulesDemo } from "../scenes";
import { LandingSection } from "./section";

/** Owner: L3. Cycles (progress + burn-down), modules and estimates. */
export function PlanSection() {
  const copy = useLandingCopy().home.plan;
  return (
    <LandingSection id="plan" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <CyclesDemo />
      </LazyMount>
      <div className="mt-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <LazyMount className="aspect-[10/7]">
            <ModulesDemo />
          </LazyMount>
        </div>
        <div className="lg:col-span-2">
          <h3 className="font-medium text-lg">{copy.estimates.title}</h3>
          <p className="mt-2 text-muted-foreground leading-relaxed">
            {copy.estimates.description}
          </p>
          <EstimatesPreview className="mt-6" />
        </div>
      </div>
    </LandingSection>
  );
}
