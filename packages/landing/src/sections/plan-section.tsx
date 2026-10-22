"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { CyclesDemo, EstimatesPreview, ModulesDemo } from "../scenes";
import { LandingSection, LandingSectionDetail } from "./section";

/** Cycles (progress + burn-down), modules and estimates. */
export function PlanSection() {
  const copy = useLandingCopy().home.plan;
  return (
    <LandingSection id="plan" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <CyclesDemo />
      </LazyMount>
      <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-5 lg:gap-8">
        <div className="lg:col-span-3">
          <LazyMount className="aspect-[10/7]">
            <ModulesDemo />
          </LazyMount>
        </div>
        <LandingSectionDetail
          className="lg:col-span-2"
          title={copy.estimates.title}
          description={copy.estimates.description}
        >
          <EstimatesPreview />
        </LandingSectionDetail>
      </div>
    </LandingSection>
  );
}
