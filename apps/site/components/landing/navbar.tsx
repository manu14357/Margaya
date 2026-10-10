"use client";

import { LandingNavbar } from "@margaya/landing";
import { SiteLandingProviders } from "./site-landing";

/**
 * The shared public navbar, used by every site page including the docs.
 * `localized` on the home and feature pages, which follow the visitor's
 * language; elsewhere it stays English with no language control.
 */
export function Navbar({ localized = false }: { localized?: boolean }) {
  return (
    <SiteLandingProviders localized={localized}>
      <LandingNavbar />
    </SiteLandingProviders>
  );
}
