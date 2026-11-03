"use client";

import type { ReactNode } from "react";
import { type LandingCopy, LandingCopyProvider } from "./copy";
import {
  type LandingLinkComponent,
  type LandingLinks,
  LandingLinksProvider,
} from "./links";
import { type LandingPrefs, LandingPrefsProvider } from "./prefs";
import {
  AiSection,
  AutomateSection,
  DocsSection,
  FactsStrip,
  FaqSection,
  FinalCtaSection,
  HeroSection,
  InsightSection,
  KeyboardSection,
  LandingFooter,
  LandingNavbar,
  OwnItSection,
  PlanSection,
  PublicBoardsSection,
  TriageSection,
  ViewsSection,
  YourDaySection,
} from "./sections";

/**
 * The providers in one: copy, links, the app's router link and, optionally,
 * the visitor's language and theme (without `prefs`, no controls render).
 */
export function LandingProviders({
  copy,
  links,
  linkComponent,
  prefs,
  children,
}: {
  copy: LandingCopy;
  links: LandingLinks;
  linkComponent?: LandingLinkComponent;
  prefs?: LandingPrefs;
  children: ReactNode;
}) {
  const content = (
    <LandingCopyProvider copy={copy}>
      <LandingLinksProvider links={links} linkComponent={linkComponent}>
        {children}
      </LandingLinksProvider>
    </LandingCopyProvider>
  );
  return prefs ? (
    <LandingPrefsProvider prefs={prefs}>{content}</LandingPrefsProvider>
  ) : (
    content
  );
}

/**
 * The whole home page, in the spec's order. Render it inside
 * `LandingProviders`. Pass `chrome={false}` when the host layout already
 * renders the navbar and footer.
 */
export function LandingPage({ chrome = true }: { chrome?: boolean }) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      {chrome && <LandingNavbar />}
      <main>
        <HeroSection />
        <FactsStrip />
        <ViewsSection />
        <AiSection />
        <PlanSection />
        <TriageSection />
        <DocsSection />
        <YourDaySection />
        <InsightSection />
        <AutomateSection />
        <PublicBoardsSection />
        <KeyboardSection />
        <OwnItSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      {chrome && <LandingFooter />}
    </div>
  );
}
