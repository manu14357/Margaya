"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { DigestPreview, HomeDemo, YourWorkDemo } from "../scenes";
import { LandingSection } from "./section";

/** Owner: L3. Home widgets with stickies, Your work, and the digest email. */
export function YourDaySection() {
  const copy = useLandingCopy().home.yourDay;
  return (
    <LandingSection id="your-day" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <HomeDemo />
      </LazyMount>
      <div className="mt-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <LazyMount className="aspect-[10/7]">
            <YourWorkDemo />
          </LazyMount>
        </div>
        <div className="lg:col-span-2">
          <h3 className="font-medium text-lg">{copy.digest.title}</h3>
          <p className="mt-2 text-muted-foreground leading-relaxed">
            {copy.digest.description}
          </p>
          <DigestPreview className="mt-6" />
        </div>
      </div>
    </LandingSection>
  );
}
