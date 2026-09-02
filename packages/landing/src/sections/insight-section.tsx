"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { AnalyticsDemo } from "../scenes/analytics/analytics-scene";
import { AuditLogDemo } from "../scenes/audit-log/audit-log-scene";
import { TrashDemo } from "../scenes/trash/trash-scene";
import { LandingSection } from "./section";

/** Owner: L4. Analytics chart builder, audit log list and trash restore. */
export function InsightSection() {
  const copy = useLandingCopy().home.insight;
  return (
    <LandingSection id="insight" copy={copy}>
      <LazyMount className="aspect-[2/1]">
        <AnalyticsDemo />
      </LazyMount>
      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8">
        <LazyMount className="aspect-[19/14]">
          <AuditLogDemo />
        </LazyMount>
        <LazyMount className="aspect-[19/14]">
          <TrashDemo />
        </LazyMount>
      </div>
    </LandingSection>
  );
}
