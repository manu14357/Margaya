import type { LandingLinks } from "@margaya/landing";
import { alternativePath } from "@/lib/comparisons/types";
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
    docs: featurePath("docs"),
    automate: featurePath("automate"),
    selfHost: featurePath("self-host"),
  },
  site: {
    changelog: `${GITHUB_URL}/releases`,
    roadmap: `${GITHUB_URL}/issues`,
    alternatives: "/alternatives",
    compareJira: alternativePath("jira"),
    compareTrello: alternativePath("trello"),
    compareLinear: alternativePath("linear"),
    compareAsana: alternativePath("asana"),
    compareClickup: alternativePath("clickup"),
    compareMonday: alternativePath("monday"),
    blog: "/blog",
    guides: "/guides",
    press: "/press",
    privacy: "/privacy",
    terms: "/terms",
    license: `${GITHUB_URL}/blob/main/LICENSE`,
  },
};
