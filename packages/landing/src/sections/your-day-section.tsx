"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { DigestPreview, HomeDemo, YourWorkDemo } from "../scenes";
import { LandingSection, LandingSectionDetail } from "./section";

/** Home widgets with stickies, Your work, and the digest email. */
export function YourDaySection() {
  const copy = useLandingCopy().home.yourDay;
  return (
    <LandingSection id="your-day" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <HomeDemo />
      </LazyMount>
      <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-5 lg:gap-8">
        <div className="lg:col-span-3">
          <LazyMount className="aspect-[10/7]">
            <YourWorkDemo />
          </LazyMount>
        </div>
        <LandingSectionDetail
          className="lg:col-span-2"
          title={copy.digest.title}
          description={copy.digest.description}
        >
          <DigestPreview />
        </LandingSectionDetail>
      </div>
    </LandingSection>
  );
}
