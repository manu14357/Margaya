"use client";

import { useLandingCopy } from "../copy";
import { ViewsShowcase } from "../scenes";
import { LandingSection } from "./section";

/**
 * Owner: L2. Board / List / Spreadsheet / Calendar / Gantt tabs over one
 * stage; each tab plays a short scripted interaction, then the next one.
 */
export function ViewsSection() {
  const copy = useLandingCopy().home.views;
  return (
    <LandingSection id="views" copy={copy}>
      <ViewsShowcase />
    </LandingSection>
  );
}
