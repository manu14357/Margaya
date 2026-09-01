// @margaya/landing: the public landing experience, shared by apps/site and
// apps/web. See README.md for the contracts and how to add scenes.

export {
  fill,
  type LandingCopy,
  LandingCopyProvider,
  useLandingCopy,
} from "./copy";
export * from "./demo";
export { LandingPage, LandingProviders } from "./landing-page";
export { LandingButton } from "./lib/button";
export { cn } from "./lib/cn";
export { LazyMount } from "./lib/lazy-mount";
export { LandingLogo } from "./lib/logo";
export {
  LandingLink,
  type LandingLinkComponent,
  type LandingLinkProps,
  type LandingLinks,
  LandingLinksProvider,
  useLandingLinks,
} from "./links";
export { mergeLandingCopy } from "./merge";
export {
  hasLanguageChoice,
  LANDING_LOCALES,
  LANDING_THEMES,
  type LandingLocale,
  type LandingPrefs,
  LandingPrefsProvider,
  type LandingTheme,
  useLandingPrefs,
} from "./prefs";
export * from "./replica";
export * from "./scenes";
export * from "./sections";
