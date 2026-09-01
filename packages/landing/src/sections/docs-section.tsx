"use client";

import { useLandingCopy } from "../copy";
import { LazyMount } from "../lib/lazy-mount";
import { DocsDemo } from "../scenes/docs/docs-scene";
import { LandingSection } from "./section";

/**
 * Owner: L4. A page with two cursors co-editing, a slash menu inserting a
 * callout, and a pasted task link becoming a chip.
 */
export function DocsSection() {
  const copy = useLandingCopy().home.docs;
  return (
    <LandingSection id="docs" copy={copy}>
      <LazyMount className="aspect-[16/10]">
        <DocsDemo />
      </LazyMount>
    </LandingSection>
  );
}
