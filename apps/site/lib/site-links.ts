import type { LandingLinks } from "@margaya/landing";
import { featurePath } from "@/lib/features";

const GITHUB_URL = "https://github.com/manu14357/Margaya";

/** Every href the shared landing components render on the public site. */
export const siteLinks: LandingLinks = {
  home: "/",
  // There is no hosted service yet, so "Get started" leads to the self-host
  // guide and the navbar leaves out Sign in.
  signUp: "/docs/core/installation",
  selfHost: "/docs/core/installation",
  docs: "/docs/core",
  apiReference: "/docs/api-reference/introduction",
  pricing: "/pricing",
  github: GITHUB_URL,
  features: {
    plan: featurePath("plan"),
    views: featurePath("views"),
    ai: featurePath("ai"),
    docs: featurePath("docs"),
    automate: featurePath("automate"),
    selfHost: featurePath("self-host"),
  },
  site: {
    changelog: `${GITHUB_URL}/releases`,
    roadmap: `${GITHUB_URL}/issues`,
    guides: "/guides",
    press: "/press",
    privacy: "/privacy",
    terms: "/terms",
    license: `${GITHUB_URL}/blob/main/LICENSE`,
  },
};
